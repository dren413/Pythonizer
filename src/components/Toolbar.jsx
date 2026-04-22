import React, { useState, useEffect } from 'react';
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
  } = useDesignStore();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [showPythonDialog, setShowPythonDialog] = useState(false);
  const [pythonPathInput, setPythonPathInput] = useState('');
  const [pythonVersion, setPythonVersion] = useState('Unknown');
  const [pythonSource, setPythonSource] = useState('unknown');
  const [pythonError, setPythonError] = useState('');

  // ── Menu listeners ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const offNew = window.electronAPI.onMenuNewProject(() => setShowNewDialog(true));
    const offSave = window.electronAPI.onMenuSaveProject(() => { void handleSave(); });
    const offRun = window.electronAPI.onMenuRun(() => { void handleRun(); });
    const offStop = window.electronAPI.onMenuStop(() => handleStop());
    const offPy = window.electronAPI.onMenuPythonInterpreter(() => { void openPythonDialog(); });
    const offOpen = window.electronAPI.onProjectOpened((data) => loadProject(data));
    return () => {
      offNew?.();
      offSave?.();
      offRun?.();
      offStop?.();
      offPy?.();
      offOpen?.();
    };
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

  async function handleNewProject() {
    if (!window.electronAPI) return;
    try {
      const dir = await window.electronAPI.newProject();
      if (dir) {
        clearProject();
        setProject(dir, newName || basenameFromPath(dir));
        setShowNewDialog(false);
        setNewName('');
      }
    } catch (error) {
      appendConsoleOutput(`Error creating project: ${error.message || String(error)}\n`);
    }
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

  async function handleSave() {
    if (!window.electronAPI) return;
    const state = useDesignStore.getState();
    const guiPy = generateGuiPy(state.widgets, state.windowTitle, state.canvasSize, state.windowResizable, state.windowBg);
    try {
      const dir = await window.electronAPI.saveProject({
        projectPath: state.projectPath,
        projectJSON: JSON.stringify(state.getProjectData(), null, 2),
        guiPy,
        mainPy: state.userCode || generateMainPyTemplate(state.widgets),
        extraFiles: state.extraFiles,
      });
      if (dir) {
        setProject(dir, state.projectName || basenameFromPath(dir));
      }
      return dir || null;
    } catch (error) {
      appendConsoleOutput(`Error saving project: ${error.message || String(error)}\n`);
      return null;
    }
  }

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
        <button className="tb-btn" onClick={() => setShowNewDialog(true)} title="New Project">
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
        <div className="dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Project</h3>
            <label>Project name:</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNewProject()}
              placeholder="MyApp" autoFocus />
            <div className="dialog-actions">
              <button onClick={handleNewProject}>Create</button>
              <button onClick={() => setShowNewDialog(false)}>Cancel</button>
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
              <button onClick={handleBrowsePython}>Browse…</button>
              <button onClick={handleResetPython}>Reset Auto/Bundled</button>
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
    </div>
  );
}
