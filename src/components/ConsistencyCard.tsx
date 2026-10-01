"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { retry } from "@/lib/retry";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";

type Activity = {
  current: number;
  best: number;
  total_days: number;
  last_active: string | null;
  today: string;
  days: Record<string, number>;
};

export function ConsistencyCard() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [a, setA] = useState<Activity | null>(null);

  useEffect(() => {
    retry(async () => {
      const { data, error } = await supabase.rpc("cf_study_activity");
      if (error) throw error;
      return data as Activity;
    })
      .then(setA)
      .catch(() => {});
  }, [supabase]);

  if (!a) return null;
  const hasAny = a.total_days > 0;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-bold">Study consistency</h2>
          <p className="text-xs text-ink3">
            {hasAny
              ? "Little and often beats cramming — spacing is what makes it stick."
              : "Do anything today — a quick test, a practice set, a logged score — to start your record."}
          </p>
        </div>
        <div className="flex gap-5">
          <Stat label="current" value={a.current} unit={a.current === 1 ? "day" : "days"} accent />
          <Stat label="best run" value={a.best} unit={a.best === 1 ? "day" : "days"} />
          <Stat label="days studied" value={a.total_days} unit="total" />
        </div>
      </div>
      <div className="mt-4">
        <ActivityHeatmap days={a.days} today={a.today} />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <p className={`text-xl font-black tabular-nums ${accent ? "text-accenthi" : "text-ink"}`}>
        {value} <span className="text-xs font-medium text-ink3">{unit}</span>
      </p>
    </div>
  );
}
