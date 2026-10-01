// Placeholder objectives.
//
// The full deployment ships one GENERATED module per exam here
// (scripts/extract-objectives.ts writes ccao-f.ts, ccdv-f.ts, ccar-f.ts,
// ccar-p.ts from the official exam-guide PDFs). That text belongs to the exam
// publisher and is not redistributed in this repository, so each per-exam
// module re-exports this stub instead: one group per blueprint domain carrying
// a single explanatory bullet. Re-running the extractor against your own copy
// of the guides overwrites the per-exam modules with the real data.
import type { DomainObjectives } from "../objectives";
import { getExam } from "../exams";

export const STUB_NOTE =
  "Objectives are not included in this repository. Run scripts/extract-objectives.ts against your copy of the exam guide to generate them.";

export function stubObjectives(examCode: string): DomainObjectives[] {
  return (getExam(examCode)?.domains ?? []).map((d) => ({
    domain: d.name,
    groups: [{ title: null, weight: null, summary: null, knowledge: [], skills: [], points: [STUB_NOTE] }],
  }));
}
