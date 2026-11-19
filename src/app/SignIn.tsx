import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { siGithub, siGoogle } from 'simple-icons';
import { SECTION_BY_ID } from '@/app/routes';
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@/components/ui';
import { PrivacyLink } from '@/entrypoints/privacy/PrivacyLink';
import { authRedirectUrl, isCode, isEmail, providerLabel, sendEmailCode, signInWith, verifyEmailCode } from '@/lib/supabase/auth';
import { EMAIL_SIGN_IN_ENABLED, isBackendConfigured } from '@/lib/supabase/client';
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

/** Email sign-in with a one-time code: no password, and no link to click (which is awkward inside an extension). */
function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    const err = await sendEmailCode(email);
    setBusy(false);
    if (err) setProblem(err);
    else {
      setSent(true);
      setCode('');
    }
  };
  const verify = async () => {
    setBusy(true);
    setProblem(null);
    const err = await verifyEmailCode(email, code);
    setBusy(false);
    if (err) setProblem(err); // on success the auth listener signs us in and the dialog/gate closes
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        void (sent ? verify() : send());
      }}
    >
      <Label htmlFor="si-email">Or use your email</Label>
      <Input
        id="si-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        maxLength={254}
        disabled={sent}
        onChange={(e) => setEmail(e.target.value)}
      />
      {sent && (
        <div>
          <Label htmlFor="si-code">Code from the email we sent to {email.trim()}</Label>
          <Input
            id="si-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            maxLength={12}
            className="font-mono tracking-widest"
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
      )}
      {problem && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive-text">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={sent ? !isCode(code) : !isEmail(email)} className="flex-1">
          {sent ? 'Sign in' : 'Email me a code'}
        </Button>
        {sent && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setProblem(null);
            }}
          >
            Change email
          </Button>
        )}
      </div>
      {sent && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void send()}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Send a new code
        </button>
      )}
    </form>
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
      {EMAIL_SIGN_IN_ENABLED && (
        <>
          <div className="flex items-center gap-3 text-xs text-subtle-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <EmailSignIn />
        </>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none py-1 hover:text-foreground">Trouble signing in?</summary>
        <p className="mt-1 leading-relaxed">
          The sign-in provider must be allowed to send you back here. In your Supabase project, add this to Authentication → URL Configuration → Redirect URLs:
        </p>
        <code className="mt-1.5 block break-all rounded-md border bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">{authRedirectUrl()}</code>
      </details>
      <p className="text-xs leading-relaxed text-subtle-foreground">
        No password to remember. pact uses {EMAIL_SIGN_IN_ENABLED ? 'GitHub, Google or your email' : 'GitHub or Google'} only to sign you in, and your notes are
        private to your account. <PrivacyLink>Read the privacy policy</PrivacyLink>.
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
        <div data-gate-icon className="mx-auto grid size-11 place-items-center rounded-lg bg-brand-soft text-brand-text">
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
