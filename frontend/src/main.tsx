import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './tokens/theme.css';
import { getInitialTheme, applyTheme } from './tokens/themeBridge.ts';

// Initialize design system theme
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
