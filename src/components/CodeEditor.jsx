import React, { useMemo, useRef, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { keymap, EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab, insertNewlineAndIndent, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import useDesignStore from '../store/designStore';
import { generateGuiPy, generateMainPyTemplate, enforceMainPyTemplate } from '../utils/codeGenerator';
import { Minus, Plus, X } from 'lucide-react';

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

const PROTECTED_MAIN_PATTERNS = [
  /^from gui import AppGUI, run$/,
  /^import pygame$/,
  /^class App\(AppGUI\):$/,
  /^    def on_start\(self\):$/,
  /^    def _game_loop\(self\):$/,
  /^run\(App\)$/,
];

function isProtectedMainLine(text) {
  return PROTECTED_MAIN_PATTERNS.some((pattern) => pattern.test(text));
}

function buildProtectedMainPyExtension() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;

    let touchesProtectedLine = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      const startLine = tr.startState.doc.lineAt(fromA);
      const endLine = tr.startState.doc.lineAt(Math.min(toA, tr.startState.doc.length));
      for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
        if (isProtectedMainLine(tr.startState.doc.line(lineNo).text)) {
          touchesProtectedLine = true;
          break;
        }
      }
    });

    return touchesProtectedLine ? [] : tr;
  });
}

export default function CodeEditor() {
  const {
    widgets, userCode, activeTab, extraFiles, theme, editorScale, expertMode,
    windowTitle, canvasSize, windowResizable, windowBg,
    setUserCode, setActiveTab, addExtraFile, removeExtraFile, updateExtraFile,
    designUndo, designRedo, setEditorScale, resetEditorScale,
  } = useDesignStore();

  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const editorViewRef = useRef(null);

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
    const handlePrint = () => window.print();
    const offPrint = window.electronAPI?.onMenuPrintCode?.(handlePrint);
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 'p') return;
      e.preventDefault();
      handlePrint();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      offPrint?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const source = userCode || generateMainPyTemplate(widgets);
    const normalized = enforceMainPyTemplate(source, widgets, userCode);
    if (normalized !== userCode) {
      setUserCode(normalized, false);
    }
  }, [widgets]);

  // Auto-generate initial main.py template if empty
  const mainPyCode = userCode || generateMainPyTemplate(widgets);
  const guiPyCode = generateGuiPy(widgets, windowTitle, canvasSize, windowResizable, windowBg);

  const extraFileNames = Object.keys(extraFiles);
  // gui.py is only shown in expert mode
  const tabs = expertMode
    ? ['main.py', 'gui.py', ...extraFileNames]
    : ['main.py', ...extraFileNames];

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

  function clampScale(scale) {
    return Math.min(1.8, Math.max(0.75, Math.round(scale * 20) / 20));
  }

  function zoomIn() {
    setEditorScale(clampScale(editorScale + 0.1));
  }

  function zoomOut() {
    setEditorScale(clampScale(editorScale - 0.1));
  }

  function handleEditorWheelCapture(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    if (e.deltaY > 0) zoomOut();
  }

  const fontSizePx = Math.round(13 * editorScale);
  const isReadonly = activeTab === 'gui.py';
  const widgetCompletionSource = useMemo(() => buildWidgetCompletionSource(widgets), [widgets]);
  const extensions = [
    python(),
    keymap.of([
      { key: 'Enter', run: insertNewlineAndIndent },
      indentWithTab,
      { key: 'Mod-=', run: () => { zoomIn(); return true; } },
      { key: 'Mod-Shift-=', run: () => { zoomIn(); return true; } },
      { key: 'Mod--', run: () => { zoomOut(); return true; } },
      { key: 'Mod-0', run: () => { resetEditorScale(); return true; } },
      { key: 'Ctrl-=', run: () => { zoomIn(); return true; } },
      { key: 'Ctrl-Shift-=', run: () => { zoomIn(); return true; } },
      { key: 'Ctrl--', run: () => { zoomOut(); return true; } },
      { key: 'Ctrl-0', run: () => { resetEditorScale(); return true; } },
    ]),
    autocompletion({ activateOnTyping: true }),
    pythonLanguage.data.of({ autocomplete: widgetCompletionSource }),
    EditorView.theme({
      '&': { fontSize: `${fontSizePx}px` },
      '.cm-gutters': { fontSize: `${fontSizePx}px` },
    }),
  ];
  if (activeTab === 'main.py') extensions.push(buildProtectedMainPyExtension());
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
        <div className="editor-tabs-spacer" />
        <div className="editor-zoom-controls">
          <button className="tab-add-btn" onClick={zoomOut} title="Zoom out">
            <Minus size={14} />
          </button>
          <button className="editor-zoom-value" onClick={resetEditorScale} title="Reset zoom">
            {Math.round(editorScale * 100)}%
          </button>
          <button className="tab-add-btn" onClick={zoomIn} title="Zoom in">
            <Plus size={14} />
          </button>
        </div>
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

      <div className="editor-content" onWheelCapture={handleEditorWheelCapture}>
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
