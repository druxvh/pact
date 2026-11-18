import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import '@/store/useThemeStore';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { startNotesSync } from '@/features/notes/sync/engine';
import { startAppearance } from '@/lib/appearance/apply';
import { installAsyncErrorGuard } from '@/lib/asyncErrors';
import { startAutoSnapshots } from '@/lib/backup';
import { installSpotlight } from '@/lib/spotlight';
import { startAuth } from '@/lib/supabase/auth';
import { startProfileSync } from '@/lib/supabase/profile';
import App from './App';

installAsyncErrorGuard();
installSpotlight();
void startAppearance();
startProfileSync();
startNotesSync();
void startAuth();
startAutoSnapshots();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
