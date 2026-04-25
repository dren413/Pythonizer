import React, { useState, useEffect, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import useDesignStore from '../store/designStore';
import { generateGuiPy, generateMainPyTemplate } from '../utils/codeGenerator';
import { basenameFromPath } from '../utils/path';
import { Save, Play, Square, FolderPlus, Moon, Sun } from 'lucide-react';
import iconPng from '../../assets/icon.png';

export default function Toolbar() {
  const {
    projectPath, projectName, widgets, windowTitle, canvasSize, windowResizable,
    userCode, extraFiles, isRunning, setProject, loadProject, clearProject,
    appendConsoleOutput, setIsRunning, clearConsole, theme, toggleTheme,
    expertMode: _expertMode, toggleExpertMode, markSaved,
  } = useDesignStore();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [projectDialogMode, setProjectDialogMode] = useState('new');
  const [projectDialogError, setProjectDialogError] = useState('');
  const [showPythonDialog, setShowPythonDialog] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [pythonPathInput, setPythonPathInput] = useState('');
  const [pythonVersion, setPythonVersion] = useState('Unknown');
  const [pythonSource, setPythonSource] = useState('unknown');
  const [pythonError, setPythonError] = useState('');
  const pendingSaveResolverRef = useRef(null);
  const handleSaveRef = useRef(null);

  // ── Menu listeners ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const offNew = window.electronAPI.onMenuNewProject(() => openProjectDialog('new'));
    const offSave = window.electronAPI.onMenuSaveProject(() => { void handleSave(); });
    const offRun = window.electronAPI.onMenuRun(() => { void handleRun(); });
    const offStop = window.electronAPI.onMenuStop(() => handleStop());
    const offPy = window.electronAPI.onMenuPythonInterpreter(() => { void openPythonDialog(); });
    const offOpen = window.electronAPI.onProjectOpened((data) => loadProject(data));
    const offAbout = window.electronAPI.onMenuAbout?.(() => setShowAboutDialog(true));
    const offExpert = window.electronAPI.onMenuToggleExpertMode?.(() => toggleExpertMode());
    return () => {
      offNew?.();
      offSave?.();
      offRun?.();
      offStop?.();
      offPy?.();
      offOpen?.();
      offAbout?.();
      offExpert?.();
    };
  }, []);

  useEffect(() => {
    const onRequestSave = async (event) => {
      const ok = await handleSaveRef.current?.();
      event.detail?.resolve?.(!!ok);
    };
    window.addEventListener('pythonizer-request-save', onRequestSave);
    return () => window.removeEventListener('pythonizer-request-save', onRequestSave);
  }, []);

  // ── Fetch app version ──
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // ── Python output ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const offStdout = window.electronAPI.onPythonStdout((d) => appendConsoleOutput(d));
    const offStderr = window.electronAPI.onPythonStderr((d) => appendConsoleOutput(`[stderr] ${d}`));
    const offExit = window.electronAPI.onPythonExit((code) => {
      appendConsoleOutput(`\n── Process exited (code ${code}) ──\n`);
      setIsRunning(false);
    });
    return () => {
      offStdout?.();
      offStderr?.();
      offExit?.();
    };
  }, []);

  function openProjectDialog(mode) {
    setProjectDialogMode(mode);
    setProjectDialogError('');
    setNewName(mode === 'save' ? (useDesignStore.getState().projectName || '') : '');
    setShowNewDialog(true);
  }

  function closeProjectDialog(result = false) {
    const mode = projectDialogMode;
    setShowNewDialog(false);
    setProjectDialogError('');
    setNewName('');
    if (mode === 'save' && pendingSaveResolverRef.current) {
      pendingSaveResolverRef.current(result);
      pendingSaveResolverRef.current = null;
    }
  }

  async function chooseParentDirectory(title) {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === 'string' ? selected : null;
  }

  async function handleNewProject() {
    if (!window.electronAPI) return null;
    const projectName = newName.trim();
    if (!projectName) {
      setProjectDialogError('Project name cannot be empty.');
      return null;
    }
    try {
      const parentDir = await chooseParentDirectory(
        projectDialogMode === 'new'
          ? 'Choose location for new project'
          : 'Choose location to save project',
      );
      if (!parentDir) {
        return null;
      }

      const dir = await window.electronAPI.newProject({ projectName, parentDir });
      if (dir) {
        if (projectDialogMode === 'new') {
          clearProject();
          setProject(dir, projectName);
          markSaved();
          closeProjectDialog(true);
          return dir;
        }

        const savedDir = await persistProject(dir, projectName);
        closeProjectDialog(!!savedDir);
        return savedDir;
      }
    } catch (error) {
      const message = error.message || String(error);
      if (message === 'Project creation was cancelled.') {
        return null;
      }
      setProjectDialogError(message);
      appendConsoleOutput(`Error creating project: ${message}\n`);
    }
    return null;
  }

  async function openPythonDialog() {
    if (!window.electronAPI) return;
    try {
      const info = await window.electronAPI.getPythonInfo();
      setPythonPathInput((info && info.command) || '');
      setPythonVersion((info && info.version) || 'Unknown');
      setPythonSource((info && info.source) || 'unknown');
      setPythonError('');
      setShowPythonDialog(true);
    } catch (error) {
      setPythonError(error.message || String(error));
      setShowPythonDialog(true);
    }
  }

  async function handleBrowsePython() {
    if (!window.electronAPI) return;
    try {
      const picked = await window.electronAPI.pickPythonInterpreter();
      if (picked) setPythonPathInput(picked);
    } catch (error) {
      setPythonError(error.message || String(error));
    }
  }

  async function handleSavePython() {
    if (!window.electronAPI) return;
    const command = pythonPathInput.trim();
    if (!command) {
      setPythonError('Interpreter path cannot be empty.');
      return;
    }
    try {
      const res = await window.electronAPI.setPythonInterpreter({ command });
      if (!res || !res.ok) {
        setPythonError((res && res.error) || 'Failed to set interpreter.');
        return;
      }
      const info = await window.electronAPI.getPythonInfo();
      setPythonVersion((info && info.version) || 'Unknown');
      setPythonSource((info && info.source) || 'unknown');
      setPythonError('');
      setShowPythonDialog(false);
    } catch (error) {
      setPythonError(error.message || String(error));
    }
  }

  async function handleResetPython() {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.resetPythonInterpreter();
      if (!res || !res.ok) {
        setPythonError((res && res.error) || 'Failed to reset interpreter.');
        return;
      }
      const info = await window.electronAPI.getPythonInfo();
      setPythonPathInput((info && info.command) || '');
      setPythonVersion((info && info.version) || 'Unknown');
      setPythonSource((info && info.source) || 'unknown');
      setPythonError('');
    } catch (error) {
      setPythonError(error.message || String(error));
    }
  }

  async function persistProject(projectPathOverride = null, projectNameOverride = null) {
    if (!window.electronAPI) return;
    const state = useDesignStore.getState();
    const guiPy = generateGuiPy(state.widgets, state.windowTitle, state.canvasSize, state.windowResizable, state.windowBg);
    try {
      const dir = await window.electronAPI.saveProject({
        projectPath: projectPathOverride ?? state.projectPath,
        projectJson: JSON.stringify(state.getProjectData(), null, 2),
        guiPy,
        mainPy: state.userCode || generateMainPyTemplate(state.widgets),
        extraFiles: state.extraFiles,
      });
      if (dir) {
        setProject(dir, projectNameOverride || state.projectName || basenameFromPath(dir));
        markSaved();
      }
      return dir || null;
    } catch (error) {
      appendConsoleOutput(`Error saving project: ${error.message || String(error)}\n`);
      return null;
    }
  }

  async function handleSave() {
    if (!window.electronAPI) return null;
    const state = useDesignStore.getState();
    if (state.projectPath) {
      return persistProject();
    }

    return new Promise((resolve) => {
      pendingSaveResolverRef.current = resolve;
      openProjectDialog('save');
    });
  }
  handleSaveRef.current = handleSave;

  async function handleRun() {
    if (!window.electronAPI || isRunning) return;
    clearConsole();
    const savedDir = await handleSave();
    const state = useDesignStore.getState();
    const projectPathToRun = state.projectPath || savedDir;
    if (!projectPathToRun) {
      appendConsoleOutput('Error: Save the project to a folder before running.\n');
      return;
    }
    try {
      const result = await window.electronAPI.runPython({ projectPath: projectPathToRun });
      if (result?.error) {
        appendConsoleOutput(`Error: ${result.error}\n`);
      } else {
        setIsRunning(true);
        appendConsoleOutput('── Running… ──\n');
      }
    } catch (error) {
      appendConsoleOutput(`Error: ${error.message || String(error)}\n`);
    }
  }

  function handleStop() {
    if (!window.electronAPI) return;
    window.electronAPI.stopPython();
    setIsRunning(false);
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <img src={iconPng} alt="Pythonizer" style={{ width: 30, height: 30 }} />
        <span className="toolbar-title">Pythonizer</span>
        {projectName && <span className="toolbar-project">— {projectName}</span>}
      </div>
      <div className="toolbar-right">
        <button className="tb-btn" onClick={() => openProjectDialog('new')} title="New Project">
          <FolderPlus size={16} />
        </button>
        <button className="tb-btn" onClick={handleSave} title="Save Project">
          <Save size={16} />
        </button>
        <button className="tb-btn" onClick={toggleTheme} title="Toggle Theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="tb-sep" />
        <button className="tb-btn tb-run" onClick={handleRun} disabled={isRunning} title="Run (F5)">
          <Play size={16} />
        </button>
        <button className="tb-btn tb-stop" onClick={handleStop} disabled={!isRunning} title="Stop (Shift+F5)">
          <Square size={16} />
        </button>
      </div>

      {showNewDialog && (
        <div className="dialog-overlay" onClick={() => closeProjectDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{projectDialogMode === 'new' ? 'New Project' : 'Save Project'}</h3>
            <label>Project name:</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNewProject()}
              placeholder="MyApp" autoFocus />
            {projectDialogError && (
              <div style={{ color: 'var(--red)', fontSize: 12, marginTop: -6, marginBottom: 10 }}>
                {projectDialogError}
              </div>
            )}
            <div className="dialog-actions">
              <button onClick={handleNewProject}>
                {projectDialogMode === 'new' ? 'Create' : 'Save'}
              </button>
              <button onClick={() => closeProjectDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showPythonDialog && (
        <div className="dialog-overlay" onClick={() => setShowPythonDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
            <h3>Python Interpreter</h3>
            <label>Interpreter path:</label>
            <input
              value={pythonPathInput}
              onChange={(e) => setPythonPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePython()}
              placeholder="C:\\Python312\\python.exe or /usr/bin/python3"
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="dialog-btn" onClick={handleBrowsePython}>Browse…</button>
              <button className="dialog-btn" onClick={handleResetPython}>Reset Auto/Bundled</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Source: {pythonSource} | Version: {pythonVersion}
            </div>
            {pythonError && (
              <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{pythonError}</div>
            )}
            <div className="dialog-actions">
              <button onClick={handleSavePython}>Save</button>
              <button onClick={() => setShowPythonDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showAboutDialog && (
        <div className="dialog-overlay" onClick={() => setShowAboutDialog(false)}>
          <div className="dialog about-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 340, textAlign: 'center' }}>
            <img src={iconPng} alt="Pythonizer" style={{ width: 72, height: 72, marginBottom: 12, borderRadius: 16 }} />
            <h3 style={{ marginBottom: 4 }}>Pythonizer</h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>Version {appVersion}</div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Dren Gashi</div>
            <a href="mailto:gasdr413@gmail.com"
              style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'block', marginBottom: 4 }}
              onClick={(e) => e.stopPropagation()}>
              gasdr413@gmail.com
            </a>
            <a href="https://github.com/dren413/Pythonizer"
              target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'block', marginBottom: 16 }}
              onClick={(e) => e.stopPropagation()}>
              github.com/dren413/Pythonizer
            </a>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              A minimalistic Python/tkinter GUI builder for CS students.
            </div>
            <div className="dialog-actions" style={{ justifyContent: 'center' }}>
              <button onClick={() => setShowAboutDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
