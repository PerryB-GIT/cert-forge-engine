// Exam blueprint data — verified against guides/*.pdf (Section 6; CCAR-F Section 4) on 2026-07-13.
// The seed script (scripts/extract-blueprint.ts) re-extracts these from the PDFs and diffs them.

export type Domain = { name: string; weight: number };

export type Exam = {
  code: string;
  name: string;
  shortName: string;
  items: number;
  fee: number;
  minutes: number;
  domains: Domain[];
  scenarioBank?: { total: number; drawn: number; perScenario: number };
  /** Score by plain item percent instead of blueprint-weighted domains (see 2026-09-25-scoring-holdout.sql). */
  perItemScoring?: boolean;
  /** A sealed go/no-go form exists (cf_holdout); items never appear in practice or other sims. */
  holdoutItems?: number;
};

export const CUT_SCORE = 720;
export const SCALE_MIN = 100;
export const SCALE_MAX = 1000;
/** Weighted percent-correct that maps exactly to the 720 cut: (720-100)/900 */
export const CUT_PCT = ((CUT_SCORE - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100; // 68.888...

export const EXAMS: Exam[] = [
  {
    code: "CCAO-F",
    name: "Claude Certified Associate – Foundations",
    shortName: "Associate Foundations",
    items: 60,
    fee: 99,
    minutes: 120,
    domains: [
      { name: "Prompting and Task Execution", weight: 14 },
      { name: "Output Evaluation and Validation", weight: 21 },
      { name: "Product and Model Selection", weight: 12 },
      { name: "Workflow Integration and Solution Design", weight: 16 },
      { name: "Configuration and Knowledge Management", weight: 12 },
      { name: "Governance, Risk, and Responsible Use", weight: 15 },
      { name: "Troubleshooting and Optimization", weight: 10 },
    ],
  },
  {
    code: "CCDV-F",
    name: "Claude Certified Developer – Foundations",
    shortName: "Developer Foundations",
    items: 53,
    fee: 125,
    minutes: 120,
    domains: [
      { name: "Agents and Workflows", weight: 14.7 },
      { name: "Applications and Integration", weight: 33.1 },
      { name: "Claude Code", weight: 3.1 },
      { name: "Eval, Testing, and Debugging", weight: 2.6 },
      { name: "Model Selection and Optimization", weight: 16.8 },
      { name: "Prompt and Context Engineering", weight: 11.0 },
      { name: "Security and Safety", weight: 8.1 },
      { name: "Tools and MCPs", weight: 10.6 },
    ],
  },
  {
    code: "CCAR-F",
    name: "Claude Certified Architect – Foundations",
    shortName: "Architect Foundations",
    items: 60,
    fee: 125,
    minutes: 120,
    scenarioBank: { total: 6, drawn: 4, perScenario: 15 },
    perItemScoring: true,
    holdoutItems: 60,
    domains: [
      { name: "Agentic Architecture & Orchestration", weight: 27 },
      { name: "Tool Design & MCP Integration", weight: 18 },
      { name: "Claude Code Configuration & Workflows", weight: 20 },
      { name: "Prompt Engineering & Structured Output", weight: 20 },
      { name: "Context Management & Reliability", weight: 15 },
    ],
  },
  {
    code: "CCAR-P",
    name: "Claude Certified Architect – Professional",
    shortName: "Architect Professional",
    items: 63,
    fee: 175,
    minutes: 120,
    domains: [
      { name: "Solution Design & Architecture", weight: 17 },
      { name: "Claude Models, Prompting & Context Engineering", weight: 13 },
      { name: "Integration", weight: 19 },
      { name: "Evaluation, Testing & Optimization", weight: 16 },
      { name: "Governance, Safety & Risk Management", weight: 14 },
      { name: "Stakeholder Communication & Lifecycle Management", weight: 14 },
      { name: "Developer Productivity & Operational Enablement", weight: 7 },
    ],
  },
];

export const EXAM_ORDER = ["CCAO-F", "CCDV-F", "CCAR-F", "CCAR-P"] as const;

export const CLEAN_SWEEP_COST = EXAMS.reduce((s, e) => s + e.fee, 0); // $524

export function getExam(code: string): Exam | undefined {
  return EXAMS.find((e) => e.code === code);
}
