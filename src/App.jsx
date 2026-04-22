import React, { useEffect, useRef, useCallback, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Close-requested: warn if unsaved (native OS dialog) ──
  useEffect(() => {
    let unlisten;
    let skipConfirm = false;

    const setup = async () => {
      unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        if (skipConfirm) return;           // already confirmed — let it close
        if (!useDesignStore.getState().isDirty) return; // no changes — let it close
        event.preventDefault();
        try {
          const ok = await ask('You have unsaved changes. Close without saving?', {
            title: 'Unsaved Changes',
            kind: 'warning',
          });
          if (ok) {
            skipConfirm = true;
            await getCurrentWindow().close(); // re-fires event; skipConfirm bypasses gate
          }
        } catch {
          // dialog failed — force close
          skipConfirm = true;
          await getCurrentWindow().close();
        }
      });
    };

    setup();
    return () => {
      skipConfirm = true; // prevent any pending close from showing dialog during teardown
      unlisten?.();
    };
  }, []);

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
    </div>
  );
}
