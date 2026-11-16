import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import '@/store/useThemeStore';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { startAppearance } from '@/lib/appearance/apply';
import { installSpotlight } from '@/lib/spotlight';
import App from './App';

installSpotlight();
void startAppearance();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
