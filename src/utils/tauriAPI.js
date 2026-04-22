/**
 * Tauri API shim — exposes the same interface as the old window.electronAPI
 * so all React components work unchanged.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function onEvent(eventName, cb) {
  const unlistenPromise = listen(eventName, (e) => cb(e.payload));
  return () => { unlistenPromise.then((unlisten) => unlisten()); };
}

const tauriAPI = {
  // ── Project ──────────────────────────────────────────────────────────────
  newProject: () => invoke('new_project'),
  openProject: () => {},  // open is driven by the menu (Rust emits project-opened)
  saveProject: (data) => invoke('save_project', { args: data }),

  // ── Python interpreter ────────────────────────────────────────────────────
  getPythonInfo: () => invoke('get_python_info'),
  pickPythonInterpreter: () => invoke('pick_python_interpreter'),
  setPythonInterpreter: (data) => invoke('set_python_interpreter', { command: data.command }),
  resetPythonInterpreter: () => invoke('reset_python_interpreter'),

  // ── Run ───────────────────────────────────────────────────────────────────
  runPython: (data) => invoke('run_python', { projectPath: data.projectPath }),
  stopPython: () => invoke('stop_python'),

  // ── Menu events ───────────────────────────────────────────────────────────
  onMenuNewProject:        (cb) => onEvent('menu-new-project',        cb),
  onMenuSaveProject:       (cb) => onEvent('menu-save-project',       cb),
  onMenuRun:               (cb) => onEvent('menu-run',                cb),
  onMenuStop:              (cb) => onEvent('menu-stop',               cb),
  onMenuPrintCode:         (cb) => onEvent('menu-print-code',         cb),
  onMenuToggleTheme:       (cb) => onEvent('menu-toggle-theme',       cb),
  onMenuToggleExpertMode:  (cb) => onEvent('menu-toggle-expert-mode', cb),
  onMenuAbout:             (cb) => onEvent('menu-about',              cb),
  onMenuNewFile:           (cb) => onEvent('menu-new-file',           cb),
  onMenuPythonInterpreter: (cb) => onEvent('menu-python-interpreter', cb),
  onMenuUndo:              (cb) => onEvent('menu-undo',               cb),
  onMenuRedo:              (cb) => onEvent('menu-redo',               cb),

  // ── Data events ───────────────────────────────────────────────────────────
  onProjectOpened: (cb) => onEvent('project-opened', cb),
  onPythonStdout:  (cb) => onEvent('python-stdout',  cb),
  onPythonStderr:  (cb) => onEvent('python-stderr',  cb),
  onPythonExit:    (cb) => onEvent('python-exit',    cb),
};

export default tauriAPI;
