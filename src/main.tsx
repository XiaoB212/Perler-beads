import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/canvas.css';
import './styles/panels.css';
import './styles/dialogs.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
