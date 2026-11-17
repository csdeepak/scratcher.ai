// Entry of welcome.html: the desktop app's first-start page (choose the workspace folder).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Welcome } from './components/Welcome';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
