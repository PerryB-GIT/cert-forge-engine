import { ResultsView } from "@/components/ResultsView";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ResultsView sessionId={sessionId} />;
}
