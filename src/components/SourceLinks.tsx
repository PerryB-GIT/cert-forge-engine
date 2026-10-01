import { sourceFor } from "@/lib/sources";

/**
 * "Where this comes from" for an answered item: the exam-guide section plus
 * official Anthropic pages to study it. Render only after the item is answered,
 * next to the rationale.
 */
export function SourceLinks({ itemId, domain }: { itemId: string; domain: string }) {
  const src = sourceFor(itemId, domain);
  if (!src) return null;
  return (
    <div className="rounded-lg border border-edge p-3 text-xs text-ink2">
      <p>
        <b className="text-ink">Source:</b>{" "}
        <a
          href={src.guideHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accenthi underline"
        >
          {src.exam} Exam Guide, p. {src.guidePage}
        </a>{" "}
        · {src.domain}
        {src.task && (
          <>
            {" "}
            · Task {src.task.id}: {src.task.title}
          </>
        )}
      </p>
      {src.docs.length > 0 && (
        <p className="mt-1">
          <b className="text-ink">Study:</b>{" "}
          {src.docs.map((d, i) => (
            <span key={d.url}>
              {i > 0 && " · "}
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accenthi underline"
              >
                {d.title}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
