import React, { useEffect, useState } from 'react';
import useDesignStore, { WIDGET_EVENTS } from '../store/designStore';

export default function AttributeInspector() {
  const {
    widgets, selectedWidgetId, windowTitle, canvasSize, windowResizable, windowBg,
    updateWidget, updateWidgetProps, removeWidget, toggleWidgetEvent,
    setWindowTitle, setCanvasSize, setWindowResizable, setWindowBg, isNameTaken,
  } = useDesignStore();
  const [nameError, setNameError] = useState(null);
  const [nameDraft, setNameDraft] = useState('');

  const widget = widgets.find((w) => w.id === selectedWidgetId);

  useEffect(() => {
    if (!widget) return;
    setNameDraft(widget.name);
    setNameError(null);
  }, [widget?.id, widget?.name]);

  // ── Window properties (when nothing selected) ──
  if (!widget) {
    return (
      <div className="attribute-inspector">
        <div className="panel-header">Window Properties</div>
        <div className="inspector-body">
          <label>Title</label>
          <input value={windowTitle} onChange={(e) => setWindowTitle(e.target.value)} />

          <label>Width</label>
          <input type="number" value={canvasSize.width}
            onChange={(e) => setCanvasSize({ ...canvasSize, width: parseInt(e.target.value) || 400 })} />

          <label>Height</label>
          <input type="number" value={canvasSize.height}
            onChange={(e) => setCanvasSize({ ...canvasSize, height: parseInt(e.target.value) || 300 })} />

          <label className="inspector-toggle">
            <input type="checkbox" checked={windowResizable}
              onChange={(e) => setWindowResizable(e.target.checked)} />
            Resizable
          </label>

          <label>Background</label>
          <div className="color-prop-row">
            <input
              type="color"
              className="color-swatch"
              value={windowBg || '#ffffff'}
              onChange={(e) => setWindowBg(e.target.value)}
            />
            <span className="color-hex">{(windowBg || '#ffffff').toUpperCase()}</span>
          </div>
        </div>
      </div>
    );
  }

  const availableEvents = WIDGET_EVENTS[widget.type] || [];

  const normalizeColor = (value, fallback) => {
    const v = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  };

  const handleNameChange = (e) => {
    const newName = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
    setNameDraft(newName);
    if (!newName) {
      setNameError('Name cannot be empty.');
      return;
    }
    if (isNameTaken(newName, widget.id)) {
      setNameError(`"${newName}" is already used by another widget.`);
      return;
    }
    setNameError(null);
    updateWidget(widget.id, { name: newName });
  };

  const commitNameDraft = () => {
    if (!widget) return;
    const finalName = nameDraft.trim();
    if (!finalName || isNameTaken(finalName, widget.id)) {
      setNameDraft(widget.name);
      setNameError(null);
      return;
    }
    if (finalName !== widget.name) {
      updateWidget(widget.id, { name: finalName });
    }
    setNameError(null);
  };

  return (
    <div className="attribute-inspector">
      <div className="panel-header">Properties — {widget.type}</div>
      <div className="inspector-body">
        {/* Name */}
        <label>Name</label>
        <input value={nameDraft} onChange={handleNameChange}
          onBlur={commitNameDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitNameDraft();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setNameDraft(widget.name);
              setNameError(null);
              e.currentTarget.blur();
            }
          }}
          style={nameError ? { borderColor: 'var(--red)' } : undefined} />
        {nameError && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 2 }}>{nameError}</div>}

        {/* Text (if applicable) */}
        {'text' in widget.props && (<>
          <label>Text</label>
          <input value={widget.props.text}
            onChange={(e) => updateWidgetProps(widget.id, { text: e.target.value })} />
        </>)}

        {/* Position */}
        <label>X</label>
        <input type="number" value={widget.x}
          onChange={(e) => updateWidget(widget.id, { x: parseInt(e.target.value) || 0 })} />

        <label>Y</label>
        <input type="number" value={widget.y}
          onChange={(e) => updateWidget(widget.id, { y: parseInt(e.target.value) || 0 })} />

        <label>Width</label>
        <input type="number" value={widget.width}
          onChange={(e) => updateWidget(widget.id, { width: parseInt(e.target.value) || 10 })} />

        <label>Height</label>
        <input type="number" value={widget.height}
          onChange={(e) => updateWidget(widget.id, { height: parseInt(e.target.value) || 10 })} />

        {/* Enabled */}
        <label className="inspector-toggle">
          <input type="checkbox" checked={widget.props.enabled !== false}
            onChange={(e) => updateWidgetProps(widget.id, { enabled: e.target.checked })} />
          Enabled
        </label>

        {/* Type-specific props */}
        {'bg' in widget.props && (<>
          <label>Background</label>
          <div className="color-prop-row">
            <input
              type="color"
              className="color-swatch"
              value={normalizeColor(widget.props.bg, '#e1e1e1')}
              onChange={(e) => updateWidgetProps(widget.id, { bg: e.target.value })}
            />
            <span className="color-hex">{normalizeColor(widget.props.bg, '#e1e1e1').toUpperCase()}</span>
          </div>
        </>)}

        {'fg' in widget.props && (<>
          <label>Foreground</label>
          <div className="color-prop-row">
            <input
              type="color"
              className="color-swatch"
              value={normalizeColor(widget.props.fg, '#000000')}
              onChange={(e) => updateWidgetProps(widget.id, { fg: e.target.value })}
            />
            <span className="color-hex">{normalizeColor(widget.props.fg, '#000000').toUpperCase()}</span>
          </div>
        </>)}

        {'items' in widget.props && (<>
          <label>Items (comma-sep)</label>
          <input value={widget.props.items}
            onChange={(e) => updateWidgetProps(widget.id, { items: e.target.value })} />
        </>)}

        {'group' in widget.props && (<>
          <label>Group</label>
          <input value={widget.props.group}
            onChange={(e) => updateWidgetProps(widget.id, { group: e.target.value })} />
        </>)}

        {'value' in widget.props && (<>
          <label>Value</label>
          <input value={widget.props.value}
            onChange={(e) => updateWidgetProps(widget.id, { value: e.target.value })} />
        </>)}

        {'from_' in widget.props && (<>
          <label>From</label>
          <input type="number" value={widget.props.from_}
            onChange={(e) => updateWidgetProps(widget.id, { from_: e.target.value })} />
          <label>To</label>
          <input type="number" value={widget.props.to}
            onChange={(e) => updateWidgetProps(widget.id, { to: e.target.value })} />
          <label>Orient</label>
          <select value={widget.props.orient}
            onChange={(e) => updateWidgetProps(widget.id, { orient: e.target.value })}>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
          <label>Tick Interval</label>
          <input type="number" value={widget.props.tickinterval}
            onChange={(e) => updateWidgetProps(widget.id, { tickinterval: e.target.value })} />
          <label>Resolution</label>
          <input type="number" value={widget.props.resolution} step="0.1"
            onChange={(e) => updateWidgetProps(widget.id, { resolution: e.target.value })} />
          <label className="inspector-toggle">
            <input type="checkbox" checked={widget.props.showvalue !== false}
              onChange={(e) => updateWidgetProps(widget.id, { showvalue: e.target.checked })} />
            Show Value
          </label>
        </>)}

        {/* Events */}
        {availableEvents.length > 0 && (
          <>
            <div className="inspector-section">Events</div>
            {availableEvents.map((evt) => (
              <label key={evt} className="inspector-toggle">
                <input type="checkbox" checked={!!(widget.events && widget.events[evt])}
                  onChange={() => toggleWidgetEvent(widget.id, evt)} />
                on_{widget.name}_{evt}
              </label>
            ))}
          </>
        )}

        <button className="delete-btn" onClick={() => removeWidget(widget.id)}>
          Delete Widget
        </button>
      </div>
    </div>
  );
}
