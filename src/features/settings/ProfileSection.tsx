import { Lock, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Label, Textarea } from '@/components/ui';
import { AvatarEditor } from '@/features/settings/AvatarEditor';
import { SocialLinksEditor } from '@/features/settings/SocialLinksEditor';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useUserStore } from '@/store/useUserStore';
import { SettingsSection } from './ui';

export function ProfileSection() {
  const me = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  // The email is whatever the sign-in provided; the username was chosen once in the welcome form. Neither can be edited.
  const email = useAuthStore((s) => s.user?.email) || me.email || '';
  const [form, setForm] = useState({
    displayName: me.displayName === 'You' ? '' : me.displayName,
    designation: me.designation ?? '',
    bio: me.bio ?? '',
  });

  const baseline = {
    displayName: me.displayName === 'You' ? '' : me.displayName,
    designation: me.designation ?? '',
    bio: me.bio ?? '',
  };
  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== baseline[k]);
  const canSave = dirty;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const shownName = form.displayName.trim() || 'You';

  const save = () => {
    const saved = { displayName: shownName, designation: form.designation.trim(), bio: form.bio.trim() };
    updateProfile(saved);
    setForm({ ...saved, displayName: saved.displayName === 'You' ? '' : saved.displayName });
    notify.success('Profile saved');
  };

  return (
    <SettingsSection id="profile" icon={UserRound} title="Profile" description="Shown on your profile card in chats and communities.">
      <div className="space-y-3 py-3">
        <AvatarEditor name={shownName} handle={me.username} />

        <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
          <div>
            <Label htmlFor="set-name">Display name</Label>
            <Input id="set-name" value={form.displayName} onChange={set('displayName')} maxLength={40} placeholder="Your name" autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="set-username">Username</Label>
            <div className="relative">
              <Input id="set-username" value={`@${me.username}`} readOnly disabled aria-describedby="set-username-note" className="pr-8" />
              <Lock aria-hidden="true" className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
            </div>
            <p id="set-username-note" className="mt-1 text-xs text-subtle-foreground">
              Chosen when you joined — it can’t be changed.
            </p>
          </div>
          <div>
            <Label htmlFor="set-role">Role</Label>
            <Input id="set-role" value={form.designation} onChange={set('designation')} maxLength={60} placeholder="Student, designer, engineer…" />
          </div>
          <div>
            <Label htmlFor="set-email">Email</Label>
            <div className="relative">
              <Input id="set-email" value={email || 'Not provided by your sign-in'} readOnly disabled aria-describedby="set-email-note" className="pr-8" />
              <Lock aria-hidden="true" className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
            </div>
            <p id="set-email-note" className="mt-1 text-xs text-subtle-foreground">
              From your sign-in. Only you can see it.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="set-bio">Bio</Label>
            <Textarea id="set-bio" value={form.bio} onChange={set('bio')} rows={2} maxLength={160} placeholder="A line about you" className="min-h-14" />
          </div>
        </div>

        <SocialLinksEditor />

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
