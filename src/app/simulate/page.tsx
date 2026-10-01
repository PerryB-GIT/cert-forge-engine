import Link from "next/link";
import { EXAMS } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";

export const metadata = { title: "Exam Simulator — Cert Forge" };

export default function SimulatePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exam Simulator</h1>
        <p className="text-sm text-ink2">
          <b>Full exam</b> — the real thing: same item counts, same formats, same 120-minute clock,
          scored on the 100–1000 scale with the 720 cut, and it drives your Readiness, Chronicle,
          Scoreboard, and badges. <b>Quick test</b> — a fast diagnostic that pulls 2 questions from
          every domain for a real scaled score in a fraction of the time; it lands on your{" "}
          <Link href="/report" className="text-accenthi underline">
            Report Card
          </Link>{" "}
          without touching your Readiness. Every attempt of either kind is graphed on the Report
          Card.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {EXAMS.map((exam) => {
          const quickItems = exam.domains.length * 2;
          const quickMins = Math.max(10, Math.ceil(quickItems * 1.5));
          return (
            <div
              key={exam.code}
              className="card flex flex-col p-5"
              style={{ borderTopColor: EXAM_COLORS[exam.code], borderTopWidth: 3 }}
            >
              <h2 className="font-bold">{exam.name}</h2>
              <p className="mt-1 text-xs text-ink3">
                {exam.code} · {exam.items} items · {exam.minutes} minutes · {exam.domains.length}{" "}
                domains
                {exam.scenarioBank
                  ? ` · ${exam.scenarioBank.drawn} of ${exam.scenarioBank.total} scenarios drawn at random`
                  : ""}
              </p>
              <div className="mt-4 flex flex-1 items-end gap-2">
                <Link
                  href={`/simulate/${exam.code}`}
                  className="btn btn-primary flex-1 text-sm"
                >
                  Full exam
                </Link>
                <Link
                  href={`/simulate/${exam.code}?mode=quick`}
                  className="btn btn-ghost flex-1 text-sm"
                  title={`${quickItems} items across every domain, ~${quickMins} min`}
                >
                  Quick test · {quickItems}q
                </Link>
              </div>
              {exam.holdoutItems ? (
                <Link
                  href={`/simulate/${exam.code}?mode=holdout`}
                  className="btn btn-ghost mt-2 text-sm"
                  title="A sealed form that practice never draws from. Take it once, a few days before the real exam."
                >
                  Go/no-go form · {exam.holdoutItems}q (take once)
                </Link>
              ) : null}
              {exam.holdoutItems ? (
                <p className="mt-1.5 text-[11px] leading-snug text-ink3">
                  Sealed items practice never shows. Sit it once, timed, 2-3 days before the real
                  exam: that sitting is your cleanest read. A re-sit is all repeats and gives no
                  verdict.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink3">
        Questions are original practice items written against the public exam-guide blueprints.
        Real exam content is NDA-protected and is not reproduced here.
      </p>
    </div>
  );
}
