import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// Self-hosted so the site keeps its typography offline and makes no third-party
// request. The `opsz` build carries the optical-size axis, which is what lets
// large and small text take different shapes the way SF Display and SF Text do.
import '@fontsource-variable/inter/opsz.css';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
