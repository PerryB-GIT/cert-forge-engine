export const EXAM_COLORS: Record<string, string> = {
  "CCAO-F": "var(--sf-cat-1)",
  "CCDV-F": "var(--sf-cat-2)",
  "CCAR-F": "var(--sf-cat-3)",
  "CCAR-P": "var(--sf-cat-4)",
};

export const BADGES: Record<string, { label: string; desc: string; icon: string }> = {
  first_blood: { label: "First Blood", desc: "Logged your first score", icon: "◆" },
  "ready_CCAO-F": { label: "Ready: Associate", desc: "CCAO-F at 720+", icon: "▲" },
  "ready_CCDV-F": { label: "Ready: Developer", desc: "CCDV-F at 720+", icon: "▲" },
  "ready_CCAR-F": { label: "Ready: Architect F", desc: "CCAR-F at 720+", icon: "▲" },
  "ready_CCAR-P": { label: "Ready: Architect P", desc: "CCAR-P at 720+", icon: "▲" },
  clean_sweep: { label: "Clean Sweep", desc: "All four exams at 720+", icon: "★" },
  comfortable_margin: { label: "Comfortable Margin", desc: "Any exam at 800+", icon: "✦" },
  no_weak_domains: { label: "No Weak Domains", desc: "Every domain ≥70% on one exam", icon: "▣" },
};

export type Attempt = {
  id: number;
  exam_code: string;
  domain_name: string;
  pct_correct: number;
  source: string;
  created_at: string;
};

/** latest pct per domain for one exam from a list of attempts (newest wins) */
export function latestByDomain(attempts: Attempt[], examCode: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = attempts
    .filter((a) => a.exam_code === examCode)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);
  for (const a of rows) out[a.domain_name] = Number(a.pct_correct);
  return out;
}
