import React, { useRef, useState, useCallback, useEffect } from 'react';
import useDesignStore, { WIDGET_EVENTS } from '../store/designStore';

const IS_WINDOWS = navigator.userAgent.includes('Windows');

// ── Widget rendering ───────────────────────────────────────
function WidgetPreview({ widget }) {
  const disabledClass = widget.props.enabled === false ? ' widget-disabled' : '';

  switch (widget.type) {
    case 'Button':
      return <div className={`preview-button${disabledClass}`}>{widget.props.text}</div>;
    case 'Label':
      return <div className={`preview-label${disabledClass}`} style={{ color: widget.props.fg }}>{widget.props.text}</div>;
    case 'Entry':
      return <div className={`preview-entry${disabledClass}`} />;
    case 'Text':
      return <div className={`preview-text${disabledClass}`} />;
    case 'Listbox':
      return (
        <div className={`preview-listbox${disabledClass}`}>
          {(widget.props.items || '').split(',').map((item, i) => (
            <div key={i} className="lb-item">{item.trim()}</div>
          ))}
        </div>
      );
    case 'Checkbutton':
      return <div className={`preview-check${disabledClass}`}><span className="ck-box" /> {widget.props.text}</div>;
    case 'Radiobutton':
      return <div className={`preview-radio${disabledClass}`}><span className="rd-dot" /> {widget.props.text}</div>;
    case 'Scale': {
      const isVertical = widget.props.orient === 'vertical';
      return (
        <div className={`preview-scale${isVertical ? ' vertical' : ''}${disabledClass}`}>
          <div className="scale-track" />
          <div className="scale-thumb" />
        </div>
      );
    }
    case 'Progressbar': {
      const isVertical = widget.props.orient === 'vertical';
      const maximumRaw = Number.parseFloat(widget.props.maximum);
      const maximum = Number.isFinite(maximumRaw) && maximumRaw > 0 ? maximumRaw : 100;
      const valueRaw = Number.parseFloat(widget.props.value);
      const value = Number.isFinite(valueRaw) ? Math.min(maximum, Math.max(0, valueRaw)) : 0;
      const percent = `${Math.round((value / maximum) * 100)}%`;
      return (
        <div
          className={`preview-progressbar${isVertical ? ' vertical' : ''}${disabledClass}`}
          style={{ backgroundColor: widget.props.bg || '#e0e0e0' }}
        >
          <div
            className="progressbar-fill"
            style={isVertical
              ? { height: percent, backgroundColor: widget.props.fill || '#2f80ed' }
              : { width: percent, backgroundColor: widget.props.fill || '#2f80ed' }}
          />
        </div>
      );
    }
    case 'PygameCanvas':
      return (
        <div className="preview-pygame" style={{ backgroundColor: widget.props.bg || '#1e1e2e' }}>
          <span className="preview-pygame-icon">🎮</span>
          <span className="preview-pygame-label">pygame</span>
        </div>
      );
    default:
      return <div>{widget.type}</div>;
  }
}

// ── Canvas ─────────────────────────────────────────────────
export default function DesignCanvas() {
  const {
    widgets, selectedWidgetId, canvasSize, windowTitle, windowBg,
    addWidget, updateWidget, updateWidgetProps, selectWidget, removeWidget,
    setCanvasSize, toggleWidgetEvent, _pushHistory, isNameTaken,
  } = useDesignStore();

  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [canvasResizing, setCanvasResizing] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [ctxNameDraft, setCtxNameDraft] = useState('');
  const [ctxTextDraft, setCtxTextDraft] = useState('');
  const [ctxNameError, setCtxNameError] = useState(null);

  const isFullscreenPygame = (widget) => (
    widget.type === 'PygameCanvas' && widget.props?.fullscreen
  );

  // ── Drop from palette ──
  function handleDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('widget-type');
    if (!type) return;
    const rect = canvasRef.current.getBoundingClientRect();
    addWidget(type, Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top));
  }

  // ── Widget drag ──
  function handleWidgetMouseDown(e, widget) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectWidget(widget.id);
    setContextMenu(null);
    if (isFullscreenPygame(widget)) return;
    _pushHistory();
    const rect = canvasRef.current.getBoundingClientRect();
    setDragging({
      id: widget.id,
      offsetX: e.clientX - rect.left - widget.x,
      offsetY: e.clientY - rect.top - widget.y,
    });
  }

  // ── Widget resize handle ──
  function handleResizeMouseDown(e, widget) {
    e.stopPropagation();
    e.preventDefault();
    if (isFullscreenPygame(widget)) return;
    _pushHistory();
    setResizing({
      id: widget.id,
      startX: e.clientX,
      startY: e.clientY,
      startW: widget.width,
      startH: widget.height,
    });
  }

  // ── Canvas resize handle ──
  function handleCanvasResizeDown(e) {
    e.stopPropagation();
    e.preventDefault();
    _pushHistory();
    setCanvasResizing({
      startX: e.clientX,
      startY: e.clientY,
      startW: canvasSize.width,
      startH: canvasSize.height,
    });
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (dragging) {
        const rect = canvasRef.current.getBoundingClientRect();
        updateWidget(dragging.id, {
          x: Math.max(0, Math.round(e.clientX - rect.left - dragging.offsetX)),
          y: Math.max(0, Math.round(e.clientY - rect.top - dragging.offsetY)),
        });
      }
      if (resizing) {
        const dx = e.clientX - resizing.startX;
        const dy = e.clientY - resizing.startY;
        updateWidget(resizing.id, {
          width: Math.max(20, resizing.startW + dx),
          height: Math.max(10, resizing.startH + dy),
        });
      }
      if (canvasResizing) {
        const dx = e.clientX - canvasResizing.startX;
        const dy = e.clientY - canvasResizing.startY;
        setCanvasSize({
          width: Math.max(200, canvasResizing.startW + dx),
          height: Math.max(150, canvasResizing.startH + dy),
        });
      }
    }
    function onMouseUp() {
      setDragging(null);
      setResizing(null);
      setCanvasResizing(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, resizing, canvasResizing]);

  // ── Keyboard ──
  function handleKeyDown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidgetId) {
      removeWidget(selectedWidgetId);
    }
  }

  // ── Context menu ──
  function handleContextMenu(e, widget) {
    e.preventDefault();
    e.stopPropagation();
    selectWidget(widget.id);
    const rect = canvasRef.current.getBoundingClientRect();
    setCtxNameDraft(widget.name);
    setCtxTextDraft(widget.props.text || '');
    setCtxNameError(null);
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      widgetId: widget.id,
      widgetType: widget.type,
      widgetName: widget.name,
      widgetEvents: widget.events || {},
      hasText: 'text' in widget.props,
    });
  }

  function handleCanvasClick(e) {
    if (e.target === canvasRef.current || e.target.classList.contains('canvas-titlebar')) {
      selectWidget(null);
      setContextMenu(null);
    }
  }

  const availableEvents = contextMenu ? (WIDGET_EVENTS[contextMenu.widgetType] || []) : [];

  return (
    <div className="canvas-wrapper">
      <div className="canvas-window"
        style={{ width: canvasSize.width, height: canvasSize.height + 28 }}
      >
        {/* Titlebar */}
        <div className={`canvas-titlebar${IS_WINDOWS ? ' win' : ''}`} onClick={handleCanvasClick}>
          {IS_WINDOWS ? (
            <>
              <span className="titlebar-text win-title">{windowTitle}</span>
              <span className="win-btns">
                <span className="win-btn win-min">&#x2013;</span>
                <span className="win-btn win-max">&#x25A1;</span>
                <span className="win-btn win-close">&#x2715;</span>
              </span>
            </>
          ) : (
            <>
              <span className="titlebar-dots">
                <span className="dot red" /><span className="dot yellow" /><span className="dot green" />
              </span>
              <span className="titlebar-text">{windowTitle}</span>
            </>
          )}
        </div>

        {/* Canvas body */}
        <div className="canvas-body"
          ref={canvasRef}
          tabIndex={0}
          style={{ width: canvasSize.width, height: canvasSize.height, backgroundColor: windowBg || '#ffffff' }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={handleCanvasClick}
          onKeyDown={handleKeyDown}
        >
          {widgets.map((w) => {
            const fullscreenPygame = isFullscreenPygame(w);
            return (
              <div key={w.id}
                className={`canvas-widget${fullscreenPygame ? ' fullscreen-widget' : ''}${w.id === selectedWidgetId ? ' selected' : ''}`}
                style={{
                  left: fullscreenPygame ? 0 : w.x,
                  top: fullscreenPygame ? 0 : w.y,
                  width: fullscreenPygame ? canvasSize.width : w.width,
                  height: fullscreenPygame ? canvasSize.height : w.height,
                  backgroundColor: w.props.bg || undefined,
                }}
                onMouseDown={(e) => handleWidgetMouseDown(e, w)}
                onContextMenu={(e) => handleContextMenu(e, w)}
              >
                <div className="widget-code-label">{w.name}</div>
                <WidgetPreview widget={w} />
                {w.id === selectedWidgetId && !fullscreenPygame && (
                  <div className="resize-handle" onMouseDown={(e) => handleResizeMouseDown(e, w)} />
                )}
              </div>
            );
          })}

          {/* Context menu */}
          {contextMenu && (
            <div className="ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}>
              {/* Rename variable */}
              <div className="ctx-header">Variable name</div>
              <div className="ctx-rename-row">
                <input
                  value={ctxNameDraft}
                  autoFocus
                  style={ctxNameError ? { borderColor: 'var(--red)' } : undefined}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                    setCtxNameDraft(v);
                    if (!v) { setCtxNameError('Cannot be empty'); return; }
                    if (isNameTaken(v, contextMenu.widgetId)) { setCtxNameError('Name taken'); return; }
                    setCtxNameError(null);
                    updateWidget(contextMenu.widgetId, { name: v });
                    setContextMenu((m) => m ? { ...m, widgetName: v } : m);
                  }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && !ctxNameError)) setContextMenu(null); }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              {ctxNameError && <div style={{ color: 'var(--red)', fontSize: 10, padding: '0 12px 4px' }}>{ctxNameError}</div>}
              {/* Rename text (only for widgets that have text prop) */}
              {contextMenu.hasText && (<>
                <div className="ctx-header">Text</div>
                <div className="ctx-rename-row">
                  <input
                    value={ctxTextDraft}
                    onChange={(e) => {
                      setCtxTextDraft(e.target.value);
                      updateWidgetProps(contextMenu.widgetId, { text: e.target.value });
                    }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') setContextMenu(null); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </>)}
              {availableEvents.length > 0 && (<>
                <div className="ctx-sep" />
                <div className="ctx-header">Events</div>
                {availableEvents.map((evt) => (
                  <div key={evt} className="ctx-item"
                    onClick={() => {
                      toggleWidgetEvent(contextMenu.widgetId, evt);
                      setContextMenu((m) => m ? {
                        ...m,
                        widgetEvents: { ...m.widgetEvents, [evt]: !m.widgetEvents[evt] },
                      } : m);
                    }}>
                    <span className={`ctx-check${contextMenu.widgetEvents[evt] ? ' active' : ''}`}>
                      {contextMenu.widgetEvents[evt] ? '✓' : ' '}
                    </span>
                    on_{contextMenu.widgetName}_{evt}
                  </div>
                ))}
              </>)}
              <div className="ctx-sep" />
              <div className="ctx-item ctx-delete"
                onClick={() => { removeWidget(contextMenu.widgetId); setContextMenu(null); }}>
                Delete
              </div>
            </div>
          )}
        </div>

        {/* Canvas resize handle */}
        <div className="canvas-resize-handle" onMouseDown={handleCanvasResizeDown} />
      </div>
    </div>
  );
}
