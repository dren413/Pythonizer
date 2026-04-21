import React from 'react';
import useDesignStore from '../store/designStore';
import {
  MousePointerClick, Type, TextCursorInput, FileText,
  List, CheckSquare, Circle, SlidersHorizontal,
} from 'lucide-react';

const PALETTE = [
  { type: 'Button',      icon: MousePointerClick, label: 'Button' },
  { type: 'Label',       icon: Type,              label: 'Label' },
  { type: 'Entry',       icon: TextCursorInput,   label: 'Entry' },
  { type: 'Text',        icon: FileText,          label: 'Text' },
  { type: 'Listbox',     icon: List,              label: 'Listbox' },
  { type: 'Checkbutton', icon: CheckSquare,       label: 'Check' },
  { type: 'Radiobutton', icon: Circle,            label: 'Radio' },
  { type: 'Scale',       icon: SlidersHorizontal, label: 'Scale' },
];

export default function ComponentPalette() {
  function handleDragStart(e, type) {
    e.dataTransfer.setData('widget-type', type);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <div className="component-palette">
      <div className="panel-header">Components</div>
      <div className="palette-grid">
        {PALETTE.map(({ type, icon: Icon, label }) => (
          <div key={type} className="palette-item" draggable
               onDragStart={(e) => handleDragStart(e, type)}>
            <Icon size={18} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
