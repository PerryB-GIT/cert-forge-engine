"use client";
import { useCallback, useEffect, useState } from "react";

export type AsyncData<T> = {
  /** Null until the first successful load. Kept across a failed reload. */
  data: T | null;
  /** True when the most recent attempt failed. Check this BEFORE data. */
  failed: boolean;
  /** Re-run the loader. Safe to call from an event handler. */
  reload: () => void;
};

/**
 * Load data once on mount, with a manual retry.
 *
 * Replaces the `useCallback(load) + useEffect(() => load())` idiom this app used
 * everywhere. That shape called setState synchronously inside the effect body,
 * which cascades renders, and it had no cancellation — a slow load could resolve
 * after unmount, and a manual retry racing an in-flight load could apply the
 * stale result. Here every setState happens in a promise continuation, and a
 * `live` flag drops results from a superseded run.
 *
 * `load` MUST be referentially stable — wrap it in useCallback in the caller,
 * or the effect re-runs every render.
 */
export function useAsyncData<T>(load: () => Promise<T>): AsyncData<T> {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({
    data: null,
    failed: false,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    load()
      .then((data) => {
        if (live) setState({ data, failed: false });
      })
      .catch(() => {
        // Keep whatever was already on screen; the caller renders LoadError.
        if (live) setState((prev) => ({ data: prev.data, failed: true }));
      });
    return () => {
      live = false;
    };
  }, [load, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data: state.data, failed: state.failed, reload };
}
