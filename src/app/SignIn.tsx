import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { siGithub, siGoogle } from 'simple-icons';
import { SECTION_BY_ID } from '@/app/routes';
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { authRedirectUrl, providerLabel, signInWith } from '@/lib/supabase/auth';
import { isBackendConfigured } from '@/lib/supabase/client';
import { type AuthProvider, useAuthStore } from '@/store/useAuthStore';
import type { Section } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

const GLYPH: Record<AuthProvider, string> = { github: siGithub.path, google: siGoogle.path };

function Glyph({ provider }: { provider: AuthProvider }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d={GLYPH[provider]} />
    </svg>
  );
}

/** The two sign-in buttons, any error, and — only when it helps — the redirect URL to allow-list. */
export function SignInCard() {
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);

  if (!isBackendConfigured) {
    return (
      <p role="status" className="rounded-md border border-dashed p-3 text-[13px] text-muted-foreground">
        Accounts aren’t set up in this build yet. Add <code className="font-mono text-xs">WXT_SUPABASE_URL</code> and{' '}
        <code className="font-mono text-xs">WXT_SUPABASE_PUBLISHABLE_KEY</code> (see <code className="font-mono text-xs">.env.example</code>) and rebuild.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {(['github', 'google'] as const).map((p) => (
          <Button
            key={p}
            variant="outline"
            size="lg"
            loading={signingIn === p}
            disabled={signingIn !== null && signingIn !== p}
            onClick={() => void signInWith(p)}
          >
            <Glyph provider={p} /> Continue with {providerLabel(p)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive-text">
          {error}
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none py-1 hover:text-foreground">Trouble signing in?</summary>
        <p className="mt-1 leading-relaxed">
          The sign-in provider must be allowed to send you back here. In your Supabase project, add this to Authentication → URL Configuration → Redirect URLs:
        </p>
        <code className="mt-1.5 block break-all rounded-md border bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">{authRedirectUrl()}</code>
      </details>
      <p className="text-xs leading-relaxed text-subtle-foreground">
        No password to remember. pact uses GitHub or Google only to sign you in, and your notes are private to your account.
      </p>
    </div>
  );
}

/** Shown in place of a page that needs an account. */
export function SignInGate({ section }: { section: Section }) {
  const meta = SECTION_BY_ID[section];
  return (
    <div className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-lg bg-brand-soft text-brand-text">
          <Lock className="size-5" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Sign in to use {meta.label}</h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Search, shortcuts and your recent sites work without an account. {meta.label}, and everything else in pact, saves to your account so it follows you
            to every device.
          </p>
        </div>
        <div className="text-left">
          <SignInCard />
        </div>
      </div>
    </div>
  );
}

/** The sign-in dialog, opened from the top bar or the account button. Closes itself once you're in. */
export function SignInDialog() {
  const open = useUiStore((s) => s.signInOpen);
  const setOpen = useUiStore((s) => s.setSignInOpen);
  const signedIn = useAuthStore((s) => s.status === 'signedIn');

  useEffect(() => {
    if (signedIn) setOpen(false);
  }, [signedIn, setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Sign in to pact</DialogTitle>
          <DialogDescription>Keep your notes, tasks and settings on every device.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SignInCard />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
