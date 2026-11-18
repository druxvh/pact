/**
 * Failures that are a normal part of using a network app — offline, a request cancelled on navigation, a session that
 * expired mid-call — and that the UI already reports where it matters (a toast, the sync badge, an error panel).
 *
 * If one of these escapes as an unhandled promise rejection, Chrome files it under the extension's "Errors" list as
 * "Uncaught (in promise) …", which looks like a crash and buries real ones. `installAsyncErrorGuard()` swallows exactly
 * these (and logs them at debug level); anything else — a genuine bug — is left alone so it still shows up.
 */

const NETWORK =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|the network connection was lost|err_internet_disconnected|net::err_/i;

export function isExpectedAsyncError(reason: unknown): boolean {
  if (reason === null || reason === undefined) return false;
  const name = typeof reason === 'object' && 'name' in reason ? String((reason as { name: unknown }).name) : '';
  const message =
    typeof reason === 'string' ? reason : typeof reason === 'object' && 'message' in reason ? String((reason as { message: unknown }).message) : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  // supabase-js: a refresh/sign-in attempt that couldn't reach the server (it retries by itself), or a session that is simply gone
  if (name === 'AuthRetryableFetchError' || name === 'AuthSessionMissingError' || name === 'AuthApiError') return true;
  // the Communities store rethrows after recording the message in its `error` state, which the page shows
  if (name === 'CommunityError') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && (name === 'TypeError' || NETWORK.test(message))) return true;
  return (name === 'TypeError' || name === '') && NETWORK.test(message);
}

let installed = false;

export function installAsyncErrorGuard(target: Pick<Window, 'addEventListener'> = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (!isExpectedAsyncError(event.reason)) return;
    event.preventDefault();
    console.debug('[pact] ignored an expected async failure:', event.reason);
  });
}
