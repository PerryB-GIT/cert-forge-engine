"use client";
import { useCallback, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";

type Entry = {
  id: number;
  event_type: string;
  exam_code: string | null;
  body: string;
  created_at: string;
};

const STYLES: Record<string, { icon: string; cls: string }> = {
  score_logged: { icon: "＋", cls: "border-edge" },
  sim_completed: { icon: "▦", cls: "border-edge" },
  quick_completed: { icon: "◇", cls: "border-edge" },
  practice_completed: { icon: "↻", cls: "border-edge" },
  flashcards_completed: { icon: "◆", cls: "border-edge" },
  crossed_up: { icon: "▲", cls: "border-good bg-good/10" },
  crossed_down: { icon: "▼", cls: "border-bad bg-bad/10" },
  badge_earned: { icon: "★", cls: "border-accent bg-accent/10" },
};

export default function ChroniclePage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const load = useCallback(
    () =>
      retry(async () => {
        const { data, error } = await supabase
          .from("cf_chronicle")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300);
        if (error) throw error;
        return (data as Entry[]) ?? [];
      }),
    [supabase]
  );
  const { data: entries, failed, reload } = useAsyncData(load);

  if (failed) return <LoadError onRetry={reload} label="Couldn't load your chronicle yet." />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chronicle</h1>
        <p className="text-sm text-ink2">
          Append-only record of the process — every score, every 720 crossing, every badge. The
          history is the point; nothing here is ever edited.
        </p>
      </div>

      {entries === null ? (
        <p className="py-16 text-center text-ink3">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="py-16 text-center text-ink3">Nothing yet. Log a score to start the record.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => {
            const s = STYLES[e.event_type] ?? STYLES.score_logged;
            const milestone =
              e.event_type !== "score_logged" &&
              e.event_type !== "sim_completed" &&
              e.event_type !== "quick_completed" &&
              e.event_type !== "practice_completed" &&
              e.event_type !== "flashcards_completed";
            return (
              <li
                key={e.id}
                className={`card flex items-start gap-3 border p-3 ${s.cls} ${
                  milestone ? "font-semibold" : ""
                }`}
              >
                <span
                  className="mt-0.5 text-lg leading-none"
                  style={{ color: e.exam_code ? EXAM_COLORS[e.exam_code] : "var(--sf-ink-2)" }}
                >
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{e.body}</p>
                  <p className="mt-0.5 text-xs text-ink3">
                    {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
