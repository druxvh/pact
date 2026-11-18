/**
 * Keeps the signed-in user's profile (name, username, role, bio, onboarding flag) in `public.profiles`.
 *
 * Remote → local on sign-in; local → remote whenever the user edits it. The profile lives in the existing
 * `useUserStore` so every screen that shows "me" keeps working unchanged.
 */
import { create } from 'zustand';
import { type SocialLink, sanitizeLinks } from '@/lib/socialLinks';
import { AVATAR_BUCKET, avatarUrl } from '@/lib/supabase/avatar';
import { supabase } from '@/lib/supabase/client';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useUserStore } from '@/store/useUserStore';

/**
 * Public profile fields (other community members can read these). The email is not one of them and is not editable: it is
 * whatever the sign-in provided (`auth.users`, mirrored read-only into `profile_private`), and the username is chosen once,
 * in the welcome form, and then fixed — the database refuses to change either.
 */
type ProfileRow = {
  username: string;
  display_name: string;
  designation: string;
  bio: string;
  onboarded: boolean;
  avatar_path: string | null;
  links: SocialLink[];
};

const BASE_COLUMNS = 'username, display_name, designation, bio, onboarded, avatar_path';
const COLUMNS = `${BASE_COLUMNS}, links`;
type PublicColumns = Omit<ProfileRow, 'links'> & { links?: unknown };

/** False once the server has told us it has no `links` column yet (the migration isn't applied): profiles still work without them. */
let linksSupported = true;
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(e.message ?? ''));

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
    avatar_path: u.avatarPath ?? null,
    links: u.links ?? [],
    onboarded,
  };
};

const same = (a: ProfileRow | null, b: ProfileRow) =>
  a !== null && (Object.keys(b) as Array<keyof ProfileRow>).every((k) => (k === 'links' ? JSON.stringify(a.links) === JSON.stringify(b.links) : a[k] === b[k]));

function applyRemote(row: ProfileRow, providerName: string | null, email: string | null) {
  applying = true;
  try {
    useUserStore.setState((s) => ({
      currentUser: {
        ...s.currentUser,
        username: row.username,
        displayName: row.display_name || (s.currentUser.displayName !== 'You' ? s.currentUser.displayName : (providerName ?? 'You')),
        designation: row.designation,
        bio: row.bio,
        email: email ?? '',
        links: row.links,
        avatarPath: row.avatar_path ?? undefined,
        avatarUrl: avatarUrl(row.avatar_path),
      },
      // The account's own flag decides (not what this browser remembers): the welcome form is where the username is chosen.
      onboarded: row.onboarded,
    }));
  } finally {
    applying = false;
  }
  last = row;
}

async function pull(userId: string): Promise<void> {
  if (!supabase) return;
  const db = supabase;
  const providerName = useAuthStore.getState().user?.name ?? null;
  const read = () =>
    db
      .from('profiles')
      .select(linksSupported ? COLUMNS : BASE_COLUMNS)
      .eq('id', userId)
      .maybeSingle<PublicColumns>();
  let { data, error } = await read();
  if (isMissingColumn(error)) {
    linksSupported = false;
    ({ data, error } = await read());
  }
  if (!error && !data) {
    // Normally the sign-up trigger made this row; if it didn't (e.g. an account that pre-dates it), create it.
    const created = await supabase
      .from('profiles')
      .insert({ id: userId, username: `user_${userId.replace(/-/g, '').slice(0, 8)}`, display_name: (providerName ?? '').slice(0, 40) })
      .select(BASE_COLUMNS)
      .single<PublicColumns>();
    data = created.data;
    error = created.error;
  }
  if (error || !data) {
    // Opened offline (or the network dropped): that's not a problem to report — retry quietly once we're back online.
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|network|load failed/i.test(error?.message ?? '');
    if (offline) {
      window.addEventListener('online', () => useAuthStore.getState().user?.id === userId && void pull(userId), { once: true });
    } else {
      notify.error('Couldn’t load your profile', 'You can keep working; we’ll retry when you reload.');
    }
    useProfileSync.setState({ ready: true });
    return;
  }
  // The email is the sign-in's. (Read the private mirror first, fall back to the session's own address.)
  const priv = await supabase.from('profile_private').select('contact_email').eq('id', userId).maybeSingle<{ contact_email: string | null }>();
  const email = priv.data?.contact_email || useAuthStore.getState().user?.email || null;
  const row: ProfileRow = { ...data, avatar_path: data.avatar_path ?? null, links: sanitizeLinks(data.links) };
  applyRemote(row, providerName, email);
  // A brand-new profile with a provider name: persist the suggested display name too.
  if (!same(row, snapshot())) schedulePush(0);
  useProfileSync.setState({ ready: true });
}

async function push(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!supabase || !user) return;
  const row = snapshot();
  if (same(last, row)) return;
  // Once the welcome form has been completed the username is fixed on the server; never send it again.
  const { username, links, ...rest } = row;
  const payload = (withLinks: boolean) => ({
    ...rest,
    ...(last?.onboarded ? null : { username }),
    ...(withLinks ? { links } : null),
    updated_at: new Date().toISOString(),
  });
  let { error } = await supabase.from('profiles').update(payload(linksSupported)).eq('id', user.id);
  if (isMissingColumn(error) && linksSupported) {
    linksSupported = false;
    ({ error } = await supabase.from('profiles').update(payload(false)).eq('id', user.id));
  }
  if (!error) {
    last = row;
    return;
  }
  if (error.code === '23505') notify.error('That username is taken', 'Pick another one.');
  else if (/username_locked/.test(error.message)) notify.error('Your username is fixed', 'It can’t be changed once it has been set.');
  else if (/invalid_links/.test(error.message)) notify.error('Those links couldn’t be saved', 'Use up to five links to the platform’s own site (https).');
  else if (error.code === '23514') notify.error('That profile couldn’t be saved', 'Check the lengths and characters.');
  else notify.error('Couldn’t save your profile', 'We’ll try again on your next change.');
  await pull(user.id); // put the screen back to what's actually stored
}

function schedulePush(ms = 700) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void push(), ms);
}

/**
 * Set (or, with `null`, remove) the profile picture. The file goes to the `avatars` bucket first; only once that has
 * landed is the profile pointed at it, so a failed upload never leaves a broken picture. Older pictures are cleaned up.
 */
export async function setAvatar(blob: Blob | null): Promise<boolean> {
  const user = useAuthStore.getState().user;
  if (!supabase || !user || !useProfileSync.getState().ready) {
    notify.error('Sign in to change your photo', 'Your profile is still loading, or you’re offline.');
    return false;
  }
  let path: string | null = null;
  if (blob) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
    path = `${user.id}/${id}.webp`;
    const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    if (up.error) {
      notify.error('Couldn’t upload your photo', 'Check your connection and try again.');
      return false;
    }
  }
  const { error } = await supabase.from('profiles').update({ avatar_path: path, updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) {
    if (path) void supabase.storage.from(AVATAR_BUCKET).remove([path]);
    notify.error('Couldn’t save your photo', 'Please try again.');
    return false;
  }
  applying = true;
  try {
    useUserStore.setState((s) => ({ currentUser: { ...s.currentUser, avatarPath: path ?? undefined, avatarUrl: avatarUrl(path) } }));
  } finally {
    applying = false;
  }
  if (last) last = { ...last, avatar_path: path };
  // Keep the bucket tidy: everything in your folder except the current picture goes (best effort — a leftover is harmless).
  void supabase.storage
    .from(AVATAR_BUCKET)
    .list(user.id)
    .then(({ data }) => {
      const stale = (data ?? []).map((f) => `${user.id}/${f.name}`).filter((p) => p !== path);
      if (stale.length) return supabase?.storage.from(AVATAR_BUCKET).remove(stale);
    });
  return true;
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
