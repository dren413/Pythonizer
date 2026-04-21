import React, { useMemo, useRef, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { keymap, EditorView } from '@codemirror/view';
import { indentWithTab, insertNewlineAndIndent, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import useDesignStore from '../store/designStore';
import { generateGuiPy, generateMainPyTemplate, enforceMainPyTemplate } from '../utils/codeGenerator';
import { Plus, X } from 'lucide-react';

function buildWidgetCompletionSource(widgets) {
  const seen = new Set();
  const options = [];

  for (const w of widgets) {
    if (!w?.name || seen.has(w.name)) continue;
    seen.add(w.name);
    options.push({
      label: w.name,
      type: 'variable',
      detail: w.type,
      boost: 99,
    });
  }

  return (context) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!word && !context.explicit) return null;

    const from = word ? word.from : context.pos;
    const prefix = word ? word.text : '';
    const filtered = prefix
      ? options.filter((o) => o.label.startsWith(prefix))
      : options;

    if (!filtered.length) return null;
    return { from, options: filtered };
  };
}

export default function CodeEditor() {
  const {
    widgets, userCode, activeTab, extraFiles, theme,
    windowTitle, canvasSize, windowResizable, windowBg,
    setUserCode, setActiveTab, addExtraFile, removeExtraFile, updateExtraFile,
    designUndo, designRedo,
  } = useDesignStore();

  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const editorViewRef = useRef(null);
  const editorContentRef = useRef(null);

  // ── Menu new file ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const off = window.electronAPI.onMenuNewFile(() => setShowNewFileInput(true));
    return () => off?.();
  }, []);

  // ── Menu undo/redo ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const offUndo = window.electronAPI.onMenuUndo(() => {
      const view = editorViewRef.current;
      if (view && view.hasFocus) {
        cmUndo(view);
      } else {
        designUndo();
      }
    });
    const offRedo = window.electronAPI.onMenuRedo(() => {
      const view = editorViewRef.current;
      if (view && view.hasFocus) {
        cmRedo(view);
      } else {
        designRedo();
      }
    });
    return () => { offUndo?.(); offRedo?.(); };
  }, []);

  useEffect(() => {
    const source = userCode || generateMainPyTemplate(widgets);
    const normalized = enforceMainPyTemplate(source, widgets, userCode);
    if (normalized !== userCode) {
      setUserCode(normalized);
    }
  }, [widgets]);

  // Auto-generate initial main.py template if empty
  const mainPyCode = userCode || generateMainPyTemplate(widgets);
  const guiPyCode = generateGuiPy(widgets, windowTitle, canvasSize, windowResizable, windowBg);

  const extraFileNames = Object.keys(extraFiles);
  const tabs = ['main.py', 'gui.py', ...extraFileNames];

  function getCurrentCode() {
    if (activeTab === 'main.py') return mainPyCode;
    if (activeTab === 'gui.py') return guiPyCode;
    return extraFiles[activeTab] || '';
  }

  function handleCodeChange(value) {
    if (activeTab === 'main.py') {
      setUserCode(value);
    }
    else if (activeTab !== 'gui.py') updateExtraFile(activeTab, value);
  }

  function handleAddFile() {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.endsWith('.py')) name += '.py';
    addExtraFile(name);
    setNewFileName('');
    setShowNewFileInput(false);
  }

  function handleEditorWheelCapture(e) {
    // Preserve browser zoom gestures (trackpad pinch / Cmd/Ctrl+wheel)
    if (e.ctrlKey || e.metaKey) return;

    const root = editorContentRef.current;
    const scroller = root ? root.querySelector('.cm-scroller') : null;
    if (!scroller) return;

    const unit = e.deltaMode === 1 ? 16 : 1; // line mode vs pixel mode
    const dy = e.deltaY * unit;
    const dx = e.deltaX * unit;

    let moved = false;

    if (dy !== 0 && scroller.scrollHeight > scroller.clientHeight) {
      const before = scroller.scrollTop;
      scroller.scrollTop += dy;
      moved = moved || scroller.scrollTop !== before;
    }

    if (dx !== 0 && scroller.scrollWidth > scroller.clientWidth) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft += dx;
      moved = moved || scroller.scrollLeft !== before;
    }

    if (moved) e.preventDefault();
  }

  const isReadonly = activeTab === 'gui.py';
  const widgetCompletionSource = useMemo(() => buildWidgetCompletionSource(widgets), [widgets]);
  const extensions = [
    python(),
    keymap.of([
      { key: 'Enter', run: insertNewlineAndIndent },
      indentWithTab,
    ]),
    autocompletion({ activateOnTyping: true }),
    pythonLanguage.data.of({ autocomplete: widgetCompletionSource }),
  ];
  if (theme === 'dark') extensions.push(oneDark);

  return (
    <div className="code-editor">
      <div className="editor-tabs">
        {tabs.map((tab) => (
          <div key={tab}
            className={`editor-tab${tab === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}>
            {tab}
            {tab === 'gui.py' && <span className="tab-badge">auto</span>}
            {extraFileNames.includes(tab) && (
              <span className="tab-close" onClick={(e) => { e.stopPropagation(); removeExtraFile(tab); }}>
                <X size={12} />
              </span>
            )}
          </div>
        ))}
        <button className="tab-add-btn" onClick={() => setShowNewFileInput(true)} title="New file">
          <Plus size={14} />
        </button>
      </div>

      {showNewFileInput && (
        <div className="new-file-bar">
          <input value={newFileName} onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddFile(); if (e.key === 'Escape') setShowNewFileInput(false); }}
            placeholder="filename.py" autoFocus />
          <button onClick={handleAddFile}>Add</button>
          <button onClick={() => setShowNewFileInput(false)}>Cancel</button>
        </div>
      )}

      <div className="editor-content" ref={editorContentRef} onWheelCapture={handleEditorWheelCapture}>
        <CodeMirror
          key={`${activeTab}-${theme}`}
          value={getCurrentCode()}
          onChange={handleCodeChange}
          readOnly={isReadonly}
          extensions={extensions}
          theme={theme === 'dark' ? 'dark' : 'light'}
          height="100%"
          onCreateEditor={(view) => { editorViewRef.current = view; }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            indentOnInput: true,
            defaultKeymap: true,
            autocompletion: true,
          }}
        />
      </div>
    </div>
  );
}
