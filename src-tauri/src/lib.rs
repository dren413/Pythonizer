use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// On Windows, apply CREATE_NO_WINDOW so Python never opens a console window.
/// On other platforms this is a no-op.
#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
#[inline(always)]
fn hide_window(_cmd: &mut Command) {}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
struct PythonExec {
    command: String,
    pre_args: Vec<String>,
}

impl PythonExec {
    fn format(&self) -> String {
        if self.pre_args.is_empty() {
            self.command.clone()
        } else {
            format!("{} {}", self.command, self.pre_args.join(" "))
        }
    }
}

#[derive(Serialize)]
struct PythonInfo {
    path: String,
    command: String,
    #[serde(rename = "preArgs")]
    pre_args: Vec<String>,
    version: String,
    source: String,
}

#[derive(Serialize)]
struct PythonResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

impl PythonResult {
    fn ok_with(path: String, source: String) -> Self {
        PythonResult { ok: Some(true), error: None, path: Some(path), source: Some(source) }
    }
    fn err(msg: impl Into<String>) -> Self {
        PythonResult { ok: Some(false), error: Some(msg.into()), path: None, source: None }
    }
}

#[derive(Serialize)]
struct RunResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl RunResult {
    fn ok() -> Self { RunResult { ok: Some(true), error: None } }
    fn err(msg: impl Into<String>) -> Self { RunResult { ok: None, error: Some(msg.into()) } }
}

#[derive(Serialize, Clone)]
struct ProjectOpenedPayload {
    #[serde(rename = "projectPath")]
    project_path: String,
    #[serde(rename = "projectData")]
    project_data: Value,
    #[serde(rename = "userCode")]
    user_code: String,
    #[serde(rename = "extraFiles")]
    extra_files: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProjectArgs {
    project_path: Option<String>,
    project_json: String,
    gui_py: String,
    main_py: String,
    extra_files: Option<HashMap<String, String>>,
}

fn sanitize_project_name(name: &str) -> String {
    name.trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

// ── App State ─────────────────────────────────────────────────────────────────

pub struct AppState {
    python_exec: Arc<Mutex<PythonExec>>,
    python_source: Arc<Mutex<String>>,
    child: Arc<Mutex<Option<std::process::Child>>>,
}

// ── Settings ──────────────────────────────────────────────────────────────────

fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir.join("pythonizer-settings.json")
}

fn load_settings(app: &AppHandle) -> Value {
    fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn save_settings(app: &AppHandle, settings: &Value) {
    if let Ok(s) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(settings_path(app), s);
    }
}

// ── Python Detection ──────────────────────────────────────────────────────────

fn validate_python(exec: &PythonExec) -> bool {
    let mut cmd = Command::new(&exec.command);
    for arg in &exec.pre_args {
        cmd.arg(arg);
    }
    hide_window(&mut cmd);
    let check = r#"
import sys
import tkinter

if sys.platform == "darwin" and float(tkinter.TkVersion) < 8.6:
    raise SystemExit("macOS requires Python with Tcl/Tk 8.6 or newer")

print("ok")
"#;
    match cmd.args(["-c", check]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim() == "ok",
        Err(_) => false,
    }
}

fn can_import_python_module(exec: &PythonExec, module: &str) -> bool {
    let mut cmd = Command::new(&exec.command);
    for arg in &exec.pre_args {
        cmd.arg(arg);
    }
    hide_window(&mut cmd);
    cmd.env("PYGAME_HIDE_SUPPORT_PROMPT", "1");
    cmd.args(["-c", &format!("import {module}")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn project_uses_pygame(project_path: &str) -> bool {
    let project_file = Path::new(project_path).join("project.json");
    let Ok(contents) = fs::read_to_string(project_file) else {
        return false;
    };
    let Ok(project_data) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };
    project_data
        .get("widgets")
        .and_then(|widgets| widgets.as_array())
        .map(|widgets| {
            widgets.iter().any(|widget| {
                widget
                    .get("type")
                    .and_then(|kind| kind.as_str())
                    == Some("PygameCanvas")
            })
        })
        .unwrap_or(false)
}

fn bundled_candidates(app: &AppHandle) -> Vec<PythonExec> {
    let Ok(res) = app.path().resource_dir() else { return vec![] };
    #[cfg(windows)]
    return vec![PythonExec {
        command: res.join("python-runtime").join("python.exe").to_string_lossy().into_owned(),
        pre_args: vec![],
    }];
    #[cfg(not(windows))]
    vec![PythonExec {
        command: res.join("python-runtime").join("bin").join("python3").to_string_lossy().into_owned(),
        pre_args: vec![],
    }]
}

fn system_candidates() -> Vec<PythonExec> {
    #[cfg(windows)]
    return vec![
        PythonExec { command: "py".into(), pre_args: vec!["-3".into()] },
        PythonExec { command: "python".into(), pre_args: vec![] },
        PythonExec { command: "python3".into(), pre_args: vec![] },
        PythonExec { command: r"C:\Python313\python.exe".into(), pre_args: vec![] },
        PythonExec { command: r"C:\Python312\python.exe".into(), pre_args: vec![] },
    ];
    #[cfg(not(windows))]
    vec![
        PythonExec { command: "/opt/homebrew/bin/python3.13".into(), pre_args: vec![] },
        PythonExec { command: "/opt/homebrew/bin/python3".into(), pre_args: vec![] },
        PythonExec { command: "/usr/local/bin/python3".into(), pre_args: vec![] },
        PythonExec { command: "python3".into(), pre_args: vec![] },
        PythonExec { command: "python".into(), pre_args: vec![] },
    ]
}

fn resolve_python(app: &AppHandle) -> (PythonExec, String) {
    // 1) Bundled runtime wins
    for c in bundled_candidates(app) {
        if Path::new(&c.command).exists() && validate_python(&c) {
            return (c, "bundled".into());
        }
    }
    // 2) User-selected override
    let settings = load_settings(app);
    if let Some(cmd) = settings.get("pythonCommand").and_then(|v| v.as_str()) {
        let custom = PythonExec {
            command: cmd.into(),
            pre_args: settings.get("pythonPreArgs")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        };
        if validate_python(&custom) {
            return (custom, "custom".into());
        }
    }
    // 3) Auto-detect
    for c in system_candidates() {
        if validate_python(&c) {
            return (c, "auto".into());
        }
    }
    // 4) Fallback
    let fallback = if cfg!(windows) {
        PythonExec { command: "python".into(), pre_args: vec![] }
    } else {
        PythonExec { command: "python3".into(), pre_args: vec![] }
    };
    (fallback, "fallback".into())
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_python_info(_app: AppHandle, state: State<'_, AppState>) -> PythonInfo {
    let exec = state.python_exec.lock().unwrap().clone();
    let source = state.python_source.lock().unwrap().clone();
    let mut ver_cmd = Command::new(&exec.command);
    ver_cmd.args(&exec.pre_args).arg("--version");
    hide_window(&mut ver_cmd);
    let version = ver_cmd.output()
        .map(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string()
                + &String::from_utf8_lossy(&o.stderr);
            s.trim().to_string()
        })
        .unwrap_or_else(|_| "Unknown".into());
    PythonInfo { path: exec.format(), command: exec.command, pre_args: exec.pre_args, version, source }
}

#[tauri::command]
fn pick_python_interpreter(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select Python Interpreter")
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_python_interpreter(app: AppHandle, state: State<'_, AppState>, command: String) -> PythonResult {
    let candidate = PythonExec { command: command.clone(), pre_args: vec![] };
    if !validate_python(&candidate) {
        return PythonResult::err("Selected executable is not a valid Python with tkinter support.");
    }
    let mut settings = load_settings(&app);
    settings.as_object_mut().unwrap()
        .insert("pythonCommand".into(), Value::String(command));
    save_settings(&app, &settings);
    let (exec, source) = resolve_python(&app);
    let path = exec.format();
    *state.python_exec.lock().unwrap() = exec;
    *state.python_source.lock().unwrap() = source.clone();
    PythonResult::ok_with(path, source)
}

#[tauri::command]
fn reset_python_interpreter(app: AppHandle, state: State<'_, AppState>) -> PythonResult {
    let mut settings = load_settings(&app);
    if let Some(obj) = settings.as_object_mut() {
        obj.remove("pythonCommand");
        obj.remove("pythonPreArgs");
    }
    save_settings(&app, &settings);
    let (exec, source) = resolve_python(&app);
    let path = exec.format();
    *state.python_exec.lock().unwrap() = exec;
    *state.python_source.lock().unwrap() = source.clone();
    PythonResult::ok_with(path, source)
}

#[tauri::command]
fn new_project(project_name: String, parent_dir: String) -> Result<String, String> {
    let project_name = sanitize_project_name(&project_name);
    if project_name.is_empty() {
        return Err("Project name cannot be empty.".into());
    }
    if parent_dir.trim().is_empty() {
        return Err("Project location cannot be empty.".into());
    }

    let dir = Path::new(&parent_dir).join(&project_name);
    if dir.exists() {
        return Err(format!("A folder named '{project_name}' already exists in the selected location."));
    }

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create project folder: {e}"))?;
    let project_json = serde_json::json!({
        "version": 1, "name": project_name, "widgets": [], "windowTitle": "My App",
        "canvasSize": {"width": 500, "height": 400},
        "windowResizable": false, "extraFileNames": []
    });
    fs::write(dir.join("project.json"), serde_json::to_string_pretty(&project_json).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write project.json: {e}"))?;
    fs::write(dir.join("gui.py"), "# Auto-generated\n")
        .map_err(|e| format!("Failed to write gui.py: {e}"))?;
    fs::write(dir.join("main.py"),
        "from gui import AppGUI, run\n\n\nclass App(AppGUI):\n\n    def on_start(self):\n        pass\n\n\nrun(App)\n"
    ).map_err(|e| format!("Failed to write main.py: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_project(app: AppHandle, args: SaveProjectArgs) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let dir_str = match args.project_path {
        Some(p) if !p.is_empty() => p,
        _ => {
            let picked = app.dialog()
                .file()
                .set_title("Choose folder to save project")
                .blocking_pick_folder()
                .and_then(|f| f.into_path().ok())?;
            picked.to_string_lossy().into_owned()
        }
    };
    let dir = Path::new(&dir_str);
    fs::write(dir.join("project.json"), &args.project_json).ok()?;
    fs::write(dir.join("gui.py"), &args.gui_py).ok()?;
    fs::write(dir.join("main.py"), &args.main_py).ok()?;
    if let Some(extras) = args.extra_files {
        for (name, content) in extras {
            fs::write(dir.join(&name), content).ok();
        }
    }
    Some(dir_str)
}

#[tauri::command]
fn run_python(app: AppHandle, state: State<'_, AppState>, project_path: String) -> RunResult {
    if project_path.is_empty() {
        return RunResult::err("No project saved yet. Save first.");
    }
    {
        if state.child.lock().unwrap().is_some() {
            return RunResult::err("Already running.");
        }
    }
    let exec = state.python_exec.lock().unwrap().clone();
    if !validate_python(&exec) {
        return RunResult::err(
            "No valid Python with tkinter found. Use File > Python Interpreter… to configure one.",
        );
    }
    if project_uses_pygame(&project_path) && !can_import_python_module(&exec, "pygame") {
        return RunResult::err(format!(
            "This project uses a pygame canvas, but the selected Python interpreter ({}) cannot import pygame. Install pygame for that interpreter, or choose another one in File > Python Interpreter….",
            exec.format()
        ));
    }
    let mut cmd = Command::new(&exec.command);
    for arg in &exec.pre_args { cmd.arg(arg); }
    hide_window(&mut cmd);
    cmd.args(["-u", "main.py"])
        .current_dir(&project_path)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return RunResult::err(format!("Failed to start Python: {e}")),
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let child_arc = Arc::clone(&state.child);
    *state.child.lock().unwrap() = Some(child);

    // stdout → frontend
    {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout).lines() {
                match line {
                    Ok(l) => { let _ = app.emit("python-stdout", l + "\n"); }
                    Err(_) => break,
                }
            }
        });
    }
    // stderr → frontend
    {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stderr).lines() {
                match line {
                    Ok(l) => { let _ = app.emit("python-stderr", l + "\n"); }
                    Err(_) => break,
                }
            }
        });
    }
    // process watcher
    {
        let arc = child_arc;
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let done = {
                let mut lock = arc.lock().unwrap();
                match lock.as_mut() {
                    None => { break; } // killed externally
                    Some(c) => match c.try_wait() {
                        Ok(Some(status)) => {
                            let code = status.code().unwrap_or(-1);
                            *lock = None;
                            Some(code)
                        }
                        Ok(None) => None,
                        Err(_) => { *lock = None; Some(-1) }
                    }
                }
            };
            if let Some(code) = done {
                let _ = app.emit("python-exit", code);
                break;
            }
        });
    }
    RunResult::ok()
}

#[tauri::command]
fn stop_python(state: State<'_, AppState>) {
    let mut lock = state.child.lock().unwrap();
    if let Some(child) = lock.as_mut() {
        let _ = child.kill();
    }
    *lock = None;
}

/// Called from the JS side after the user confirms close.
/// Uses destroy() which bypasses close-requested and always works.
#[tauri::command]
fn force_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
}

// ── Open Project (called from menu handler) ───────────────────────────────────

fn handle_open_project(app: &AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    let Some(dir) = app.dialog()
        .file()
        .set_title("Open project folder")
        .blocking_pick_folder()
        .and_then(|f| f.into_path().ok())
    else {
        return;
    };

    let proj_file = dir.join("project.json");
    if !proj_file.exists() {
        app.dialog()
            .message("No project.json found in selected folder.")
            .kind(MessageDialogKind::Error)
            .title("Error")
            .blocking_show();
        return;
    }

    let project_data: Value = match fs::read_to_string(&proj_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(d) => d,
        None => return,
    };

    let user_code = fs::read_to_string(dir.join("main.py")).unwrap_or_default();

    let mut extra_files: HashMap<String, String> = HashMap::new();
    if let Some(names) = project_data.get("extraFileNames").and_then(|v| v.as_array()) {
        for name in names {
            if let Some(n) = name.as_str() {
                let content = fs::read_to_string(dir.join(n))
                    .unwrap_or_else(|_| format!("# {n}\n"));
                extra_files.insert(n.to_string(), content);
            }
        }
    }

    let _ = app.emit("project-opened", ProjectOpenedPayload {
        project_path: dir.to_string_lossy().into_owned(),
        project_data,
        user_code,
        extra_files,
    });
}

// ── Menu ──────────────────────────────────────────────────────────────────────

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // File
    let new_project = MenuItem::with_id(app, "new-project", "New Project", true, Some("CmdOrCtrl+N"))?;
    let open_project = MenuItem::with_id(app, "open-project", "Open Project…", true, Some("CmdOrCtrl+O"))?;
    let save_project = MenuItem::with_id(app, "save-project", "Save Project", true, Some("CmdOrCtrl+S"))?;
    let print_code = MenuItem::with_id(app, "print-code", "Print Code...", true, Some("CmdOrCtrl+P"))?;
    let new_file = MenuItem::with_id(app, "new-file", "New File…", true, Some("CmdOrCtrl+Shift+N"))?;
    let python_interp = MenuItem::with_id(app, "python-interpreter", "Python Interpreter…", true, None::<&str>)?;
    let sep_f1 = PredefinedMenuItem::separator(app)?;
    let sep_f2 = PredefinedMenuItem::separator(app)?;
    let sep_f3 = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;

    let file_items: &[&dyn IsMenuItem<tauri::Wry>] = &[
        &new_project, &open_project, &save_project, &print_code,
        &sep_f1, &new_file,
        &sep_f2, &python_interp,
        &sep_f3, &quit,
    ];
    let file_menu = Submenu::with_id_and_items(app, "file", "File", true, file_items)?;

    // Edit
    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let cut   = PredefinedMenuItem::cut(app, Some("Cut"))?;
    let copy  = PredefinedMenuItem::copy(app, Some("Copy"))?;
    let paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
    let sel_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
    let sep_e1 = PredefinedMenuItem::separator(app)?;
    let edit_items: &[&dyn IsMenuItem<tauri::Wry>] = &[
        &undo, &redo, &sep_e1, &cut, &copy, &paste, &sel_all,
    ];
    let edit_menu = Submenu::with_id_and_items(app, "edit", "Edit", true, edit_items)?;

    // Run
    let run_item  = MenuItem::with_id(app, "run",  "Run",  true, Some("F5"))?;
    let stop_item = MenuItem::with_id(app, "stop", "Stop", true, Some("Shift+F5"))?;
    let run_items: &[&dyn IsMenuItem<tauri::Wry>] = &[&run_item, &stop_item];
    let run_menu = Submenu::with_id_and_items(app, "run-menu", "Run", true, run_items)?;

    // View
    let toggle_theme = MenuItem::with_id(app, "toggle-theme", "Toggle Dark/Light Mode", true, Some("CmdOrCtrl+Shift+L"))?;
    let toggle_expert = MenuItem::with_id(app, "toggle-expert", "Toggle Expert Mode", true, Some("CmdOrCtrl+Shift+E"))?;
    let view_items: &[&dyn IsMenuItem<tauri::Wry>] = &[&toggle_theme, &toggle_expert];
    let view_menu = Submenu::with_id_and_items(app, "view", "View", true, view_items)?;

    // macOS app menu
    #[cfg(target_os = "macos")]
    {
        let about = MenuItem::with_id(app, "about", "About Pythonizer", true, None::<&str>)?;
        let services = PredefinedMenuItem::services(app, Some("Services"))?;
        let hide = PredefinedMenuItem::hide(app, Some("Hide Pythonizer"))?;
        let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
        let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
        let sep_a1 = PredefinedMenuItem::separator(app)?;
        let sep_a2 = PredefinedMenuItem::separator(app)?;
        let sep_a3 = PredefinedMenuItem::separator(app)?;
        let quit_app = PredefinedMenuItem::quit(app, Some("Quit Pythonizer"))?;
        let app_items: &[&dyn IsMenuItem<tauri::Wry>] = &[
            &about, &sep_a1, &services, &sep_a2,
            &hide, &hide_others, &show_all, &sep_a3,
            &quit_app,
        ];
        let app_menu = Submenu::with_id_and_items(app, "app-menu", "Pythonizer", true, app_items)?;
        let menu_items: &[&dyn IsMenuItem<tauri::Wry>] = &[
            &app_menu, &file_menu, &edit_menu, &run_menu, &view_menu,
        ];
        return Menu::with_items(app, menu_items);
    }

    #[allow(unreachable_code)]
    {
        let about = MenuItem::with_id(app, "about", "About Pythonizer", true, None::<&str>)?;
        let sep_h1 = PredefinedMenuItem::separator(app)?;
        let help_items: &[&dyn IsMenuItem<tauri::Wry>] = &[&sep_h1, &about];
        let help_menu = Submenu::with_id_and_items(app, "help", "Help", true, help_items)?;
        let menu_items: &[&dyn IsMenuItem<tauri::Wry>] = &[
            &file_menu, &edit_menu, &run_menu, &view_menu, &help_menu,
        ];
        Menu::with_items(app, menu_items)
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Resolve Python on startup
            let (exec, source) = resolve_python(&handle);
            app.manage(AppState {
                python_exec: Arc::new(Mutex::new(exec)),
                python_source: Arc::new(Mutex::new(source)),
                child: Arc::new(Mutex::new(None)),
            });

            // Build and set native menu
            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;

            // Menu event handler
            app.on_menu_event(move |app, event| {
                match event.id().as_ref() {
                    "open-project" => {
                        let app = app.clone();
                        std::thread::spawn(move || handle_open_project(&app));
                    }
                    id => {
                        let event_name = match id {
                            "new-project"         => "menu-new-project",
                            "save-project"        => "menu-save-project",
                            "new-file"            => "menu-new-file",
                            "python-interpreter"  => "menu-python-interpreter",
                            "undo"                => "menu-undo",
                            "redo"                => "menu-redo",
                            "run"                 => "menu-run",
                            "stop"                => "menu-stop",
                            "print-code"          => "menu-print-code",
                            "toggle-theme"        => "menu-toggle-theme",
                            "toggle-expert"       => "menu-toggle-expert-mode",
                            "about"               => "menu-about",
                            _ => return,
                        };
                        let _ = app.emit(event_name, ());
                    }
                }
            });

            // Intercept window close at Rust level — emit to JS so it can check isDirty.
            // Using prevent_close() + destroy() is more reliable on Windows than JS-level handling.
            if let Some(main_window) = app.get_webview_window("main") {
                let h = handle.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = h.emit("app-close-requested", ());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_python_info,
            pick_python_interpreter,
            set_python_interpreter,
            reset_python_interpreter,
            new_project,
            save_project,
            run_python,
            stop_python,
            force_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
