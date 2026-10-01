import { notFound } from "next/navigation";
import { getExam } from "@/lib/exams";
import { ExamPlayer } from "@/components/ExamPlayer";

export default async function SimulateExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { code } = await params;
  const { mode } = await searchParams;
  const exam = getExam(decodeURIComponent(code));
  if (!exam) notFound();
  return <ExamPlayer examCode={exam.code} mode={mode === "quick" ? "quick" : mode === "holdout" && exam.holdoutItems ? "holdout" : "full"} />;
}
