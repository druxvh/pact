/**
 * Profile pictures live in the public `avatars` Storage bucket; `profiles.avatar_path` holds the object path
 * (`<user id>/<random>.webp`). The database stores a *path*, never a URL, so nobody can point their avatar at a server
 * they control and watch who looks at it — the URL is always built here, from our own project.
 */
import { supabase } from '@/lib/supabase/client';

export const AVATAR_BUCKET = 'avatars';

/** Public URL for a stored avatar path (a local computation — no request). `undefined` when there is none. */
export function avatarUrl(path: string | null | undefined): string | undefined {
  if (!path || !supabase) return undefined;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}
