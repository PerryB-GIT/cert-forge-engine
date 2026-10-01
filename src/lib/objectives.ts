// Published exam-guide objectives, extracted from guides/*.pdf by
// scripts/extract-objectives.ts. Study material in Cert Forge is extracted,
// never authored — if it isn't in the official guide it doesn't go on a study
// sheet.
//
// The four guides publish objectives in three different shapes, all normalised
// into `Group` below:
//   CCAO-F / CCAR-P — a flat list of bullets per domain            -> points
//   CCDV-F          — named skills with their own weight + prose   -> title/weight/summary
//   CCAR-F          — task statements split into knowledge/skills  -> knowledge/skills
//
// The per-exam data lives in ./objectives/<code>.ts and is loaded on demand so
// CCAR-F's 300+ bullets never ship in the bundle of a page that isn't showing them.

export type Group = {
  /** Task-statement or skill name. Null when the guide lists bare bullets. */
  title: string | null;
  /** Skill weight as a share of the whole exam (CCDV-F only). */
  weight: number | null;
  /** Prose description (CCDV-F only). */
  summary: string | null;
  /** "Knowledge of:" bullets (CCAR-F only). */
  knowledge: string[];
  /** "Skills in:" bullets (CCAR-F only). */
  skills: string[];
  /** Ungrouped bullets (CCAO-F / CCAR-P). */
  points: string[];
};

export type DomainObjectives = { domain: string; groups: Group[] };

const LOADERS: Record<string, () => Promise<{ default: DomainObjectives[] }>> = {
  "CCAO-F": () => import("./objectives/ccao-f"),
  "CCDV-F": () => import("./objectives/ccdv-f"),
  "CCAR-F": () => import("./objectives/ccar-f"),
  "CCAR-P": () => import("./objectives/ccar-p"),
};

/** Load one exam's objectives. Returns [] for an unknown code. */
export async function loadObjectives(examCode: string): Promise<DomainObjectives[]> {
  const loader = LOADERS[examCode];
  if (!loader) return [];
  return (await loader()).default;
}

/** Total bullet count in a group — used to decide whether to collapse it. */
export function groupSize(g: Group): number {
  return g.points.length + g.knowledge.length + g.skills.length;
}
