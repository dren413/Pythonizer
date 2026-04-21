import React, { useRef, useEffect } from 'react';
import useDesignStore from '../store/designStore';
import { Trash2 } from 'lucide-react';

export default function ConsolePanel() {
  const { consoleOutput, clearConsole } = useDesignStore();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleOutput]);

  return (
    <div className="console-panel">
      <div className="panel-header">
        Console
        <button className="console-clear" onClick={clearConsole} title="Clear Console">
          <Trash2 size={14} />
        </button>
      </div>
      <pre className="console-body">{consoleOutput}<span ref={bottomRef} /></pre>
    </div>
  );
}
