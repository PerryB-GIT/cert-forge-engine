import { notFound } from "next/navigation";
import { getExam } from "@/lib/exams";
import { StudySheet } from "@/components/StudySheet";

export default async function StudySheetPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const exam = getExam(decodeURIComponent(code));
  if (!exam) notFound();
  return <StudySheet examCode={exam.code} />;
}
