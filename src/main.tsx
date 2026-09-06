/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { initializeDesktop } from './lib/desktop';
import './i18n';
import './styles/globals.css';
import { initializeDefaultTransports } from './lib/api-client';
import { refreshHostApiBase } from './lib/host-api';

await initializeDesktop();
const { default: App } = await import('./App');
initializeDefaultTransports();
void refreshHostApiBase();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
