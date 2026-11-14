import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import '@/store/useThemeStore';
import { installSpotlight } from '@/lib/spotlight';
import App from './App';

installSpotlight();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
