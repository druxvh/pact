/**
 * The one Supabase client. Only the *publishable* key ever ships in the extension (it is public by design — Row Level
 * Security is what protects the data); the secret/service key must never appear here.
 *
 * Configure with WXT_SUPABASE_URL and WXT_SUPABASE_PUBLISHABLE_KEY (see .env.example). Without them pact still runs
 * as a guest-only app and the sign-in screen says the backend isn't configured.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isExtension } from '@/lib/ext';

export const SUPABASE_URL: string = (import.meta.env.WXT_SUPABASE_URL as string | undefined)?.trim() ?? '';
const KEY: string = (import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';

export const AUTH_STORAGE_KEY = 'pact-auth';

/**
 * Email sign-in sends a one-time CODE, which needs the project's email template to contain `{{ .Token }}` — and Supabase only
 * lets you edit templates once custom SMTP is set up (its built-in mailer is also limited to a few emails an hour). Until
 * that's done the option stays hidden; set WXT_EMAIL_SIGN_IN=true when the template + SMTP are ready.
 */
export const EMAIL_SIGN_IN_ENABLED = (import.meta.env.WXT_EMAIL_SIGN_IN as string | undefined)?.trim() === 'true';

export const isBackendConfigured = SUPABASE_URL.startsWith('https://') && KEY.length > 0;

export const supabase: SupabaseClient | null = isBackendConfigured
  ? createClient(SUPABASE_URL, KEY, {
      auth: {
        // PKCE: the extension never sees a token in a URL, only a one-time code it exchanges.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        storageKey: AUTH_STORAGE_KEY,
        // In the extension we run the exchange ourselves (launchWebAuthFlow returns the URL); as a plain dev web
        // page the provider redirects back to this page, so let the client read `?code=`.
        detectSessionInUrl: !isExtension,
      },
    })
  : null;

/** True when a previous session is stored — lets the UI avoid flashing the guest state for a signed-in user. */
export function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
