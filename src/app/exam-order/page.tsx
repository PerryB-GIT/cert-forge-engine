import { EXAMS, CLEAN_SWEEP_COST } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";

export const metadata = { title: "Exam Order — Cert Forge" };

const ORDER = [
  {
    code: "CCAO-F",
    why: "Cheapest ticket ($99) to calibrate against the real testing experience — Pearson VUE proctoring, pacing, item style — with the least money at risk. Its heaviest domains (Output Evaluation 21%, Workflow Integration 16%, Governance 15%) are judgment skills that recur on every other exam.",
  },
  {
    code: "CCDV-F",
    why: "Builds directly on Associate-level judgment and adds the technical core: API mechanics, agents, tools, MCP. Its monster domain — Applications and Integration at 33.1% — is the deepest single domain in the program, and everything you learn for it feeds both Architect exams.",
  },
  {
    code: "CCAR-F",
    why: "Same price as Developer but scenario-based (4 of 6 randomized scenarios), so variance is higher — walk in after the Developer content is already solid and the scenarios become applications of things you know rather than new material. Agentic Architecture (27%) extends CCDV-F's agents domain.",
  },
  {
    code: "CCAR-P",
    why: "Highest fee ($175) and the widest blueprint — seven domains spanning design, integration, evals, governance, stakeholder communication, and enablement. Every prior exam contributes a slice. Take it last, when a retake is least likely.",
  },
];

export default function ExamOrderPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">The Order</h1>
        <p className="mt-1 text-sm text-ink2">
          CCAO-F → CCDV-F → CCAR-F → CCAR-P. Cheapest first for calibration, broadest last, every
          step feeding the next.
        </p>
      </div>

      <ol className="space-y-4">
        {ORDER.map((o, i) => {
          const exam = EXAMS.find((e) => e.code === o.code)!;
          return (
            <li
              key={o.code}
              className="card p-5"
              style={{ borderLeftColor: EXAM_COLORS[o.code], borderLeftWidth: 4 }}
            >
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-black text-ink3">{i + 1}</span>
                <div>
                  <h2 className="font-bold">{exam.name}</h2>
                  <p className="text-xs text-ink3">
                    {exam.code} · {exam.items} items · ${exam.fee} · {exam.domains.length} domains
                    {exam.scenarioBank ? " · 4 of 6 randomized scenarios" : ""}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink2">{o.why}</p>
            </li>
          );
        })}
      </ol>

      <section className="card p-5">
        <h2 className="font-bold">The retake math — why order matters</h2>
        <div className="mt-3 space-y-3 text-sm text-ink2">
          <p>
            Every exam carries the same retake policy: fail once and you wait <b>14 days</b>; fail
            twice, <b>30 days</b>; fail three times, <b>90 days</b> — and you pay the full fee each
            attempt. You get at most <b>four attempts per exam per rolling twelve months</b>.
          </p>
          <p>
            A worst-case slide on one exam costs 14 + 30 + 90 = <b>134 days of lockouts</b> and{" "}
            <b>4× the fee</b> before you&apos;re locked out for the year. On CCAR-P that&apos;s $700
            spent and a year&apos;s eligibility burned. That risk is why the expensive, wide-blueprint
            exam goes last — walk in over-prepared, not hopeful.
          </p>
          <p>
            The limits apply <b>per exam</b>, so failing one never blocks registering for another —
            if you hit a wall, rotate to the next exam in the order and come back.
          </p>
          <p className="rounded-lg border border-edge bg-surface2 p-3 font-semibold text-ink">
            Clean sweep, first try, all four: $99 + $125 + $125 + $175 ={" "}
            <span className="text-accenthi">${CLEAN_SWEEP_COST}</span>. Every avoided retake keeps it
            there. All four credentials are valid for 12 months, with free on-time renewal via the
            Partner Academy assessment.
          </p>
        </div>
      </section>
    </div>
  );
}
