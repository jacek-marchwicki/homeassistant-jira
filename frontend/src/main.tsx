import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './tokens/theme.css';
import { getInitialTheme, applyTheme } from './tokens/themeBridge.ts';
import { registerServiceWorker } from './utils/pwa.ts';

// Initialize design system theme
applyTheme(getInitialTheme());

// Register PWA service worker (supports standalone and Home Assistant Ingress)
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
