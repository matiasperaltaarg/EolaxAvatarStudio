import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Storage helpers shared by the delete flows. All best-effort: a leftover file
// must never block deleting the row the user asked to delete.

const LIST_PAGE_SIZE = 100;

// Recursively collect every object path under `prefix`. Supabase's `list()` is
// one level deep and reports folders as entries with a null `id`.
async function listPaths(
  client: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error || !data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        paths.push(...(await listPaths(client, bucket, path)));
      } else {
        paths.push(path);
      }
    }

    if (data.length < LIST_PAGE_SIZE) break;
    offset += data.length;
  }

  return paths;
}

// Delete every object under `prefix` (the folder itself disappears with its
// last object — Supabase Storage has no real directories).
export async function removeStorageFolder(
  client: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<void> {
  try {
    const paths = await listPaths(client, bucket, prefix);
    if (paths.length > 0) {
      await client.storage.from(bucket).remove(paths);
    }
  } catch {
    // Best-effort cleanup: orphaned files are cheaper than a failed delete.
  }
}

// Delete an explicit list of object paths, ignoring empty lists and failures.
export async function removeStorageObjects(
  client: SupabaseClient,
  bucket: string,
  paths: (string | null | undefined)[]
): Promise<void> {
  const clean = paths.filter((p): p is string => Boolean(p));
  if (clean.length === 0) return;
  try {
    await client.storage.from(bucket).remove(clean);
  } catch {
    // Best-effort cleanup.
  }
}

// Client to use for cleanup. Prefers service-role (Storage policies are not
// hardened per-account yet, so this keeps deletes deterministic), and falls
// back to the caller's authenticated client if the key is not configured —
// cleanup must never be the reason a delete fails.
export function storageCleanupClient(fallback: SupabaseClient): SupabaseClient {
  try {
    return createAdminClient();
  } catch {
    return fallback;
  }
}
