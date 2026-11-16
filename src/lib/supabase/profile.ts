/**
 * Keeps the signed-in user's profile (name, username, role, bio, onboarding flag) in `public.profiles`.
 *
 * Remote → local on sign-in; local → remote whenever the user edits it. The profile lives in the existing
 * `useUserStore` so every screen that shows "me" keeps working unchanged.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase/client';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useUserStore } from '@/store/useUserStore';

/** Public profile fields (other community members can read these) plus the private email, which lives in its own table. */
type ProfileRow = {
  username: string;
  display_name: string;
  designation: string;
  bio: string;
  onboarded: boolean;
  contact_email: string | null;
};

const COLUMNS = 'username, display_name, designation, bio, onboarded';
type PublicColumns = Omit<ProfileRow, 'contact_email'>;

/** `ready` flips true once the remote profile has been merged — the welcome flow waits for it. */
export const useProfileSync = create<{ ready: boolean }>(() => ({ ready: false }));

let applying = false;
let last: ProfileRow | null = null;
let timer: number | undefined;

const snapshot = (): ProfileRow => {
  const { currentUser: u, onboarded } = useUserStore.getState();
  return {
    username: u.username,
    display_name: u.displayName === 'You' ? '' : u.displayName,
    designation: u.designation ?? '',
    bio: u.bio ?? '',
    contact_email: u.email?.trim() ? u.email.trim() : null,
    onboarded,
  };
};

const same = (a: ProfileRow | null, b: ProfileRow) => a !== null && (Object.keys(b) as Array<keyof ProfileRow>).every((k) => a[k] === b[k]);

function applyRemote(row: ProfileRow, providerName: string | null) {
  applying = true;
  try {
    useUserStore.setState((s) => ({
      currentUser: {
        ...s.currentUser,
        username: row.username,
        displayName: row.display_name || (s.currentUser.displayName !== 'You' ? s.currentUser.displayName : (providerName ?? 'You')),
        designation: row.designation,
        bio: row.bio,
        email: row.contact_email ?? '',
      },
      onboarded: s.onboarded || row.onboarded,
    }));
  } finally {
    applying = false;
  }
  last = row;
}

async function pull(userId: string): Promise<void> {
  if (!supabase) return;
  const providerName = useAuthStore.getState().user?.name ?? null;
  let { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle<PublicColumns>();
  if (!error && !data) {
    // Normally the sign-up trigger made this row; if it didn't (e.g. an account that pre-dates it), create it.
    const created = await supabase
      .from('profiles')
      .insert({ id: userId, username: `user_${userId.replace(/-/g, '').slice(0, 8)}`, display_name: (providerName ?? '').slice(0, 40) })
      .select(COLUMNS)
      .single<PublicColumns>();
    data = created.data;
    error = created.error;
  }
  if (error || !data) {
    notify.error('Couldn’t load your profile', 'You can keep working; we’ll retry when you reload.');
    useProfileSync.setState({ ready: true });
    return;
  }
  const priv = await supabase.from('profile_private').select('contact_email').eq('id', userId).maybeSingle<{ contact_email: string | null }>();
  const row: ProfileRow = { ...data, contact_email: priv.data?.contact_email ?? null };
  applyRemote(row, providerName);
  // A brand-new profile with a provider name: persist the suggested display name too.
  if (!same(row, snapshot())) schedulePush(0);
  useProfileSync.setState({ ready: true });
}

async function push(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;
  const row = snapshot();
  if (same(last, row)) return;
  const { contact_email, ...publicPart } = row;
  const { error } = await supabase
    .from('profiles')
    .update({ ...publicPart, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (!error && contact_email !== (last?.contact_email ?? null)) {
    // The email is private: its own table, readable only by you.
    const saved = await supabase.from('profile_private').upsert({ id: user.id, contact_email }, { onConflict: 'id' });
    if (saved.error) {
      notify.error('Couldn’t save your email', 'We’ll try again on your next change.');
      return;
    }
  }
  if (!error) {
    last = row;
    return;
  }
  if (error.code === '23505') notify.error('That username is taken', 'Pick another one.');
  else if (error.code === '23514') notify.error('That profile couldn’t be saved', 'Check the lengths and characters.');
  else notify.error('Couldn’t save your profile', 'We’ll try again on your next change.');
  await pull(user.id); // put the screen back to what's actually stored
}

function schedulePush(ms = 700) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void push(), ms);
}

let started = false;

export function startProfileSync(): void {
  if (started) return;
  started = true;
  let current: string | null = null;
  const onUser = (id: string | null) => {
    if (id === current) return;
    current = id;
    window.clearTimeout(timer);
    last = null;
    useProfileSync.setState({ ready: false });
    if (id) void pull(id);
  };
  useAuthStore.subscribe((s) => onUser(s.user?.id ?? null));
  onUser(useAuthStore.getState().user?.id ?? null);

  useUserStore.subscribe((s, prev) => {
    if (applying || !current || !useProfileSync.getState().ready) return;
    if (s.currentUser === prev.currentUser && s.onboarded === prev.onboarded) return;
    schedulePush();
  });
}
