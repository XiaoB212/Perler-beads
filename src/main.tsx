import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, getThemeMode } from './core/theme';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/canvas.css';
import './styles/panels.css';
import './styles/dialogs.css';

// 首帧之前定主题，避免亮色用户看到一瞬暗色闪屏
applyTheme(getThemeMode());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
