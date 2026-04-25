import React, { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import useDesignStore from './store/designStore';
import Toolbar from './components/Toolbar';
import ComponentPalette from './components/ComponentPalette';
import DesignCanvas from './components/DesignCanvas';
import AttributeInspector from './components/AttributeInspector';
import CodeEditor from './components/CodeEditor';
import ConsolePanel from './components/ConsolePanel';
import './App.css';

export default function App() {
  const theme = useDesignStore((s) => s.theme);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [isClosingAfterSave, setIsClosingAfterSave] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Close-requested: intercepted in Rust, emits 'app-close-requested' to JS ──
  useEffect(() => {
    let unlisten;
    listen('app-close-requested', async () => {
      if (!useDesignStore.getState().isDirty) {
        await invoke('force_close');
        return;
      }
      setShowCloseDialog(true);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  function requestSave() {
    return new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent('pythonizer-request-save', {
        detail: { resolve },
      }));
    });
  }

  async function handleCloseSave() {
    setIsClosingAfterSave(true);
    try {
      const ok = await requestSave();
      if (ok) {
        await invoke('force_close');
      } else {
        setShowCloseDialog(false);
      }
    } finally {
      setIsClosingAfterSave(false);
    }
  }

  useEffect(() => {
    if (!window.electronAPI) return;
    const off = window.electronAPI.onMenuToggleTheme(() => {
      useDesignStore.getState().toggleTheme();
    });
    return () => off?.();
  }, []);

  // ── Resizable splitters ──
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(420);
  const dragging = useRef(null);

  const onMouseDown = useCallback((side) => (e) => {
    e.preventDefault();
    dragging.current = { side, startX: e.clientX, startLeft: leftWidth, startRight: rightWidth };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftWidth, rightWidth]);

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    if (dragging.current.side === 'left') {
      setLeftWidth(Math.max(160, Math.min(400, dragging.current.startLeft + dx)));
    } else {
      const maxRight = Math.round(window.innerWidth * 0.6);
      setRightWidth(Math.max(250, Math.min(maxRight, dragging.current.startRight - dx)));
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  return (
    <div className={`app-root ${theme}`}>
      <Toolbar />
      <div className="main-layout">
        <div className="left-panel" style={{ width: leftWidth }}>
          <ComponentPalette />
          <AttributeInspector />
        </div>
        <div className="splitter" onMouseDown={onMouseDown('left')} />
        <div className="center-panel">
          <DesignCanvas />
          <ConsolePanel />
        </div>
        <div className="splitter" onMouseDown={onMouseDown('right')} />
        <div className="right-panel" style={{ width: rightWidth }}>
          <CodeEditor />
        </div>
      </div>

      {showCloseDialog && (
        <div className="dialog-overlay" onClick={() => !isClosingAfterSave && setShowCloseDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Unsaved Changes</h3>
            <label style={{ marginBottom: 12 }}>
              Save your changes before closing?
            </label>
            <div className="dialog-actions">
              <button onClick={() => void handleCloseSave()} disabled={isClosingAfterSave}>
                {isClosingAfterSave ? 'Saving…' : 'Save'}
              </button>
              <button className="dialog-btn" onClick={() => void invoke('force_close')} disabled={isClosingAfterSave}>
                Don&apos;t Save
              </button>
              <button className="dialog-btn" onClick={() => setShowCloseDialog(false)} disabled={isClosingAfterSave}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
