import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { initializeDesktop } from './lib/desktop';
import './i18n';
import './styles/globals.css';

await initializeDesktop();
const { default: App } = await import('./App');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
