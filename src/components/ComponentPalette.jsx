import React, { useEffect, useRef, useState } from 'react';
import useDesignStore from '../store/designStore';
import {
  MousePointerClick, Type, TextCursorInput, FileText,
  List, CheckSquare, Circle, SlidersHorizontal, Gamepad2,
} from 'lucide-react';

const PALETTE = [
  { type: 'Button',       icon: MousePointerClick, label: 'Button' },
  { type: 'Label',        icon: Type,              label: 'Label' },
  { type: 'Entry',        icon: TextCursorInput,   label: 'Entry' },
  { type: 'Text',         icon: FileText,          label: 'Text' },
  { type: 'Listbox',      icon: List,              label: 'Listbox' },
  { type: 'Checkbutton',  icon: CheckSquare,       label: 'Check' },
  { type: 'Radiobutton',  icon: Circle,            label: 'Radio' },
  { type: 'Scale',        icon: SlidersHorizontal, label: 'Scale' },
  { type: 'PygameCanvas', icon: Gamepad2,           label: 'Pygame' },
];

export default function ComponentPalette() {
  const addWidget = useDesignStore((s) => s.addWidget);
  const dragRef = useRef(null);
  const [dragPreview, setDragPreview] = useState(null);

  useEffect(() => {
    function onMouseMove(e) {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.started) {
        const moved = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
        if (moved < 4) return;
        drag.started = true;
      }

      setDragPreview({
        label: drag.label,
        x: e.clientX + 14,
        y: e.clientY + 14,
      });
    }

    function onMouseUp(e) {
      const drag = dragRef.current;
      if (!drag) return;

      const canvas = document.querySelector('.canvas-body');
      if (drag.started && canvas) {
        const rect = canvas.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;

        if (inside) {
          addWidget(
            drag.type,
            Math.round(e.clientX - rect.left),
            Math.round(e.clientY - rect.top),
          );
        }
      }

      dragRef.current = null;
      setDragPreview(null);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [addWidget]);

  function handleMouseDown(e, type, label) {
    if (e.button !== 0) return;
    dragRef.current = {
      type,
      label,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  }

  return (
    <div className="component-palette">
      <div className="panel-header">Components</div>
      <div className="palette-grid">
        {PALETTE.map(({ type, icon: Icon, label }) => (
          <div
            key={type}
            className="palette-item"
            onMouseDown={(e) => handleMouseDown(e, type, label)}
          >
            <Icon size={22} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      {dragPreview && (
        <div
          className="palette-drag-preview"
          style={{ left: dragPreview.x, top: dragPreview.y }}
        >
          {dragPreview.label}
        </div>
      )}
    </div>
  );
}
