// Where an exam item's material comes from: the exam-guide section that
// publishes it, plus curated official pages to study it.
//
// In the full deployment, guide pages are extracted from guides/*.pdf by
// scripts/extract-guide-pages.ts into fixtures/sources/guide-pages.json, docs
// links are curated pointers in fixtures/sources/docs-links.json (each checked
// live by scripts/check-doc-links.js), and task tags live in
// fixtures/questions/tags/<CODE>.json. None of those ship in this repository
// (they are derived from the exam guides), so the imports below point at the
// original sample data for the DEMO-F sample bank. Point them at your own
// files, in the same shapes, to wire up a real bank.
import guidePages from "../../fixtures/questions/sample/guide-pages.json";
import docsLinks from "../../fixtures/questions/sample/docs-links.json";
import sampleTags from "../../fixtures/questions/sample/tags.json";

export type DocLink = { title: string; url: string; note?: string };

export type ItemSource = {
  exam: string;
  domain: string;
  /** Task-statement id ("4.3") and title, for exams whose items are tagged. */
  task: { id: string; title: string } | null;
  /** 1-based page in the exam guide PDF. */
  guidePage: number;
  /** Opens the guide (served behind login) at that page. */
  guideHref: string;
  docs: DocLink[];
};

type Tags = { tasks: Record<string, string>; items: Record<string, string> };
const TAGS: Record<string, Tags> = { "DEMO-F": sampleTags };

type Pages = { domains: Record<string, number>; tasks: Record<string, number> };
const PAGES = guidePages as Record<string, Pages & { file: string }>;

type Docs = { tasks?: Record<string, DocLink[]>; domains?: Record<string, DocLink[]> };
const DOCS = (docsLinks as { exams: Record<string, Docs> }).exams;

/** "CCAR-F-S4-07" -> "CCAR-F", "DEMO-F-D1-01" -> "DEMO-F". Null if the id has no exam prefix. */
export function examOf(itemId: string): string | null {
  const m = /^([A-Z]{4}-[FP])-/.exec(itemId);
  return m ? m[1] : null;
}

/** Task ids belonging to a domain, by the domain's position in the guide. */
function tasksInDomain(exam: string, domain: string): string[] {
  const domains = Object.keys(PAGES[exam]?.domains ?? {});
  const n = domains.indexOf(domain) + 1;
  return n ? Object.keys(TAGS[exam]?.tasks ?? {}).filter((t) => t.startsWith(`${n}.`)) : [];
}

/** Up to three distinct links, first link of each task in the domain. */
function domainFallback(exam: string, domain: string): DocLink[] {
  const seen = new Set<string>();
  const out: DocLink[] = [];
  for (const t of tasksInDomain(exam, domain)) {
    const link = DOCS[exam]?.tasks?.[t]?.[0];
    if (link && !seen.has(link.url)) {
      seen.add(link.url);
      out.push(link);
    }
    if (out.length === 3) break;
  }
  return out;
}

/** Source for one item, or null if its exam or domain is unknown. */
export function sourceFor(itemId: string, domain: string): ItemSource | null {
  const exam = examOf(itemId);
  if (!exam || !PAGES[exam]) return null;
  const pages = PAGES[exam];

  const taskId = TAGS[exam]?.items[itemId] ?? null;
  const task = taskId ? { id: taskId, title: TAGS[exam].tasks[taskId] } : null;

  const guidePage = (taskId && pages.tasks[taskId]) || pages.domains[domain];
  if (!guidePage) return null;

  const docs = taskId
    ? (DOCS[exam]?.tasks?.[taskId] ?? [])
    : (DOCS[exam]?.domains?.[domain] ?? domainFallback(exam, domain));

  return {
    exam,
    domain,
    task,
    guidePage,
    guideHref: `/api/guide/${exam}#page=${guidePage}`,
    docs,
  };
}

/** Guide PDF file name for an exam code (server-side lookup for /api/guide). */
export function guideFile(exam: string): string | null {
  return PAGES[exam]?.file ?? null;
}
