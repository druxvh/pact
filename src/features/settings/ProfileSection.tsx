import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Label, Textarea } from '@/components/ui';
import { AvatarEditor } from '@/features/settings/AvatarEditor';
import { UsernameHint } from '@/features/settings/UsernameHint';
import { useUsernameAvailability } from '@/lib/supabase/username';
import { notify } from '@/lib/toast';
import { normalizeUsername, useUserStore, validateUsername } from '@/store/useUserStore';
import { SettingsSection } from './ui';

export function ProfileSection() {
  const me = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [form, setForm] = useState({
    displayName: me.displayName === 'You' ? '' : me.displayName,
    username: me.username,
    designation: me.designation ?? '',
    email: me.email ?? '',
    bio: me.bio ?? '',
  });

  const baseline = {
    displayName: me.displayName === 'You' ? '' : me.displayName,
    username: me.username,
    designation: me.designation ?? '',
    email: me.email ?? '',
    bio: me.bio ?? '',
  };
  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== baseline[k]);
  // Usernames are unique: ask the database while you type (only when it's a valid, changed name).
  const usernameStatus = useUsernameAvailability(normalizeUsername(form.username), baseline.username);
  const usernameError =
    (form.username !== baseline.username ? validateUsername(form.username) : null) ??
    (usernameStatus === 'taken' ? 'That username is taken — try another' : null);
  const emailError = form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim()) ? 'That doesn’t look like an email address' : null;
  const canSave = dirty && !usernameError && !emailError && usernameStatus !== 'checking';
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const shownName = form.displayName.trim() || 'You';

  const save = () => {
    const saved = {
      displayName: shownName,
      username: normalizeUsername(form.username) || 'you',
      designation: form.designation.trim(),
      email: form.email.trim(),
      bio: form.bio.trim(),
    };
    updateProfile(saved);
    // Show exactly what was stored (e.g. "@Zoe_O" → "zoe_o"), otherwise the form would look unsaved forever.
    setForm({ ...saved, displayName: saved.displayName === 'You' ? '' : saved.displayName });
    notify.success('Profile saved');
  };

  return (
    <SettingsSection id="profile" icon={UserRound} title="Profile" description="Shown in chats and to friends. The username is how people find you.">
      <div className="space-y-3 py-3">
        <AvatarEditor name={shownName} handle={normalizeUsername(form.username) || 'you'} />

        <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
          <div>
            <Label htmlFor="set-name">Display name</Label>
            <Input id="set-name" value={form.displayName} onChange={set('displayName')} maxLength={40} placeholder="Your name" autoComplete="name" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label htmlFor="set-username" className="mb-0">
                Username
              </Label>
              <UsernameHint id="set-username-err" error={usernameError} status={usernameStatus} className="mt-0 min-h-0 justify-end text-right" />
            </div>
            <Input
              id="set-username"
              value={form.username}
              onChange={set('username')}
              maxLength={21}
              placeholder="you"
              autoComplete="username"
              aria-invalid={usernameError ? true : undefined}
              aria-describedby="set-username-err"
            />
          </div>
          <div>
            <Label htmlFor="set-role">Role</Label>
            <Input id="set-role" value={form.designation} onChange={set('designation')} maxLength={60} placeholder="Student, designer, engineer…" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label htmlFor="set-email" className="mb-0">
                Email (optional)
              </Label>
              <p id="set-email-err" className="min-w-0 text-right text-xs text-destructive-text" role="alert">
                {emailError}
              </p>
            </div>
            <Input
              id="set-email"
              type="email"
              value={form.email}
              onChange={set('email')}
              maxLength={120}
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby="set-email-err"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="set-bio">Bio</Label>
            <Textarea id="set-bio" value={form.bio} onChange={set('bio')} rows={2} maxLength={160} placeholder="A line about you" className="min-h-14" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setForm(baseline)}>
              Discard
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
            Save changes
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
