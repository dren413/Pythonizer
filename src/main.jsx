import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import tauriAPI from './utils/tauriAPI';

// Expose Tauri API under the same window.electronAPI interface
// so all existing components work without changes.
window.electronAPI = tauriAPI;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
