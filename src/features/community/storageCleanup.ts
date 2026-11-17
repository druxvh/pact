/**
 * Deleting a community (or a channel) removes its database rows, but files in Storage are separate objects that no
 * foreign key reaches — left alone they would sit in the bucket forever. These helpers find and remove them.
 *
 * Kept free of the Supabase client so the paging / recursion can be unit-tested with a fake bucket.
 */

export type StorageEntry = { name: string /** Folders have no id in Supabase Storage listings. */; id: string | null };
export type StorageLister = (folder: string, offset: number, limit: number) => Promise<StorageEntry[]>;

const PAGE = 1000;
const MAX_DEPTH = 4; // <community>/<uploader>/<file> is 2 levels; this is only a runaway guard

/** Every file path under `prefix` (a folder like "<community id>"), however deeply nested. */
export async function listAllFiles(list: StorageLister, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await list(prefix, offset, PAGE);
    for (const e of page) {
      if (e.id === null) {
        if (depth < MAX_DEPTH) out.push(...(await listAllFiles(list, `${prefix}/${e.name}`, depth + 1)));
      } else out.push(`${prefix}/${e.name}`);
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/** Remove `paths` in batches. Returns how many could not be removed (best effort: the rows are the source of truth). */
export async function removeInBatches(remove: (paths: string[]) => Promise<{ error: unknown }>, paths: string[], batch = 100): Promise<number> {
  let failed = 0;
  for (let i = 0; i < paths.length; i += batch) {
    const slice = paths.slice(i, i + batch);
    const { error } = await remove(slice);
    if (error) failed += slice.length;
  }
  return failed;
}

/** The distinct attachment paths mentioned in rows of `{ attachments: [...] }` (messages or their moderation originals). */
export function attachmentPaths(rows: Array<{ attachments: unknown }>): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (!Array.isArray(r.attachments)) continue;
    for (const a of r.attachments) {
      const path = (a as { path?: unknown } | null)?.path;
      if (typeof path === 'string' && path) out.add(path);
    }
  }
  return [...out];
}
