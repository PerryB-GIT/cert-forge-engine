/**
 * Retry an async loader a few times with short backoff. Used to absorb the cold-start race
 * where a client data call can fire before the Supabase session has hydrated from cookies.
 * The loader must THROW on failure (e.g. a Supabase { error } result or a missing session)
 * so a transient miss is retried instead of leaving a page stuck on a spinner.
 */
export async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Failed to load");
}
