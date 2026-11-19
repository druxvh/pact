import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import './popup.css';
import { CapturePopup } from './CapturePopup';

// theme-init.js has already applied the saved theme and accent. A wallpaper belongs to the new tab, not to a small popup.
delete document.documentElement.dataset.wallpaper;

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <StrictMode>
    <CapturePopup />
  </StrictMode>,
);
