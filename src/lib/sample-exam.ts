import type { Exam } from "./exams";

/**
 * Blueprint for the original DEMO-F sample bank
 * (fixtures/questions/sample/SAMPLE.json). It is deliberately NOT in EXAMS:
 * the app's exam list mirrors the real certification blueprints, while this
 * exists so the bank-integrity gates and source-link tests have something to
 * run against when the real banks are absent. To serve it in the app, add it to
 * EXAMS and insert matching cf_exams / cf_domains rows before seeding.
 */
export const SAMPLE_EXAM: Exam = {
  code: "DEMO-F",
  name: "Demo Exam – Foundations (sample)",
  shortName: "Demo Foundations",
  items: 4,
  fee: 0,
  minutes: 10,
  domains: [
    { name: "Software Fundamentals", weight: 50 },
    { name: "Agent Design", weight: 50 },
  ],
};
