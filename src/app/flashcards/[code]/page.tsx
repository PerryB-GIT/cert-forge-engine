import { notFound } from "next/navigation";
import { getExam } from "@/lib/exams";
import { FlashcardPlayer } from "@/components/FlashcardPlayer";

export default async function FlashcardExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { code } = await params;
  const { domain } = await searchParams;
  const exam = getExam(decodeURIComponent(code));
  if (!exam) notFound();
  return <FlashcardPlayer examCode={exam.code} domain={domain ?? null} />;
}
