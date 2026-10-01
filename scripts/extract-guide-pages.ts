/**
 * Finds the exam-guide page where each domain's objectives (and, for tagged
 * exams, each task statement) are published, so a missed item can cite
 * "Exam Guide p. N" and open the PDF at that page.
 *
 * Page numbers are EXTRACTED from guides/*.pdf, never hand-typed. The anchor for
 * each domain is its first published objective (from src/lib/objectives, itself
 * extracted from the same PDF), which skips the blueprint summary table where
 * domain names also appear. Exits non-zero if any domain or task can't be found.
 *
 * Run: npx tsx scripts/extract-guide-pages.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { loadObjectives } from "../src/lib/objectives";

const GUIDES: Record<string, string> = {
  "CCAO-F": "Claude+Certified+Associate+–+Foundations+Exam+Guide.pdf",
  "CCDV-F": "Claude+Certified+Developer+–+Foundations+Exam+Guide.pdf",
  "CCAR-F": "Claude+Certified+Architect+–+Foundations+Exam+Guide.pdf",
  "CCAR-P": "Claude+Certified+Architect+–+Professional+Exam+Guide.pdf",
};

const norm = (s: string) =>
  s.normalize("NFKC").replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * First page (1-based) at or after `from` whose text contains the snippet, or
 * null. Objectives are published in guide order, so searching forward from the
 * previous match skips the cover, intro and blueprint table, which repeat
 * domain and skill names out of context.
 */
function findPage(pages: string[], snippet: string, from = 1): number | null {
  const needle = norm(snippet).slice(0, 40);
  for (let i = from - 1; i < pages.length; i++) if (pages[i].includes(needle)) return i + 1;
  return null;
}

type ExamPages = { file: string; domains: Record<string, number>; tasks: Record<string, number> };

async function main() {
  const out: Record<string, ExamPages> = {};
  const errors: string[] = [];

  for (const [code, file] of Object.entries(GUIDES)) {
    const buf = fs.readFileSync(path.join("guides", file));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const { pages } = await parser.getText();
    const pageText = pages.map((p) => norm(p.text));
    const objectives = await loadObjectives(code);
    const exam: ExamPages = { file, domains: {}, tasks: {} };

    // Anchor on the blueprint section: the first page publishing domain 1's
    // first objective. Everything is searched forward from there.
    let cursor = 1;
    for (const d of objectives) {
      const g = d.groups[0];
      const anchor = g?.title ?? g?.points[0] ?? g?.knowledge[0] ?? d.domain;
      const page = findPage(pageText, anchor, cursor);
      if (page == null) errors.push(`${code}: domain "${d.domain}" not found`);
      else {
        exam.domains[d.domain] = page;
        cursor = page;
      }
    }

    const tagFile = path.join("fixtures", "questions", "tags", `${code}.json`);
    if (fs.existsSync(tagFile)) {
      const tags = JSON.parse(fs.readFileSync(tagFile, "utf8")) as { tasks: Record<string, string> };
      // Task ids are "<domain#>.<statement#>" in guide order; start each
      // search at its own domain's page.
      const domainPages = Object.values(exam.domains);
      for (const [id, title] of Object.entries(tags.tasks)) {
        const from = domainPages[Number(id.split(".")[0]) - 1] ?? 1;
        const page = findPage(pageText, title, from);
        if (page == null) errors.push(`${code}: task ${id} "${title}" not found`);
        else exam.tasks[id] = page;
      }
    }
    out[code] = exam;
  }

  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  const dest = path.join("fixtures", "sources", "guide-pages.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  for (const [code, e] of Object.entries(out)) {
    console.log(`${code}: ${Object.keys(e.domains).length} domains, ${Object.keys(e.tasks).length} tasks`);
  }
}

main();
