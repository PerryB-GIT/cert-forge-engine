import { notFound } from "next/navigation";
import { getExam } from "@/lib/exams";
import { PracticePlayer } from "@/components/PracticePlayer";

export default async function PracticeExamPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const exam = getExam(decodeURIComponent(code));
  if (!exam) notFound();
  return <PracticePlayer examCode={exam.code} />;
}
