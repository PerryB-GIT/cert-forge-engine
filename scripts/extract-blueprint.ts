/**
 * Reads guides/*.pdf, extracts each exam's domain/weight blueprint + exam facts,
 * writes fixtures/exams.json, and DIFFS the extraction against src/lib/exams.ts.
 * If the PDF disagrees with the hand-entered data, the PDF wins — the script exits
 * non-zero and prints the diff so it gets fixed, per spec.
 *
 * Run: npx tsx scripts/extract-blueprint.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { EXAMS } from "../src/lib/exams";

const GUIDES: Record<string, string> = {
  "CCAO-F": "Claude+Certified+Associate+–+Foundations+Exam+Guide.pdf",
  "CCDV-F": "Claude+Certified+Developer+–+Foundations+Exam+Guide.pdf",
  "CCAR-F": "Claude+Certified+Architect+–+Foundations+Exam+Guide.pdf",
  "CCAR-P": "Claude+Certified+Architect+–+Professional+Exam+Guide.pdf",
};

type Extracted = {
  code: string;
  items: number;
  fee: number;
  minutes: number;
  cut: number;
  domains: { name: string; weight: number }[];
};

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function extractOne(code: string, file: string): Promise<Extracted> {
  const buf = fs.readFileSync(path.join(__dirname, "..", "guides", file));
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const { text } = await parser.getText();
  await parser.destroy();
  const t = text.replace(/\r/g, "");

  const items = Number(/Number of items\s*(\d+)/.exec(t)?.[1]);
  const fee = Number(/Exam fee\s*\$(\d+)/.exec(t)?.[1]);
  const minutes = Number(/Time limit\s*(\d+)\s*minutes/.exec(t)?.[1]);
  const cut = Number(/cut score is\s*(\d+)/.exec(t)?.[1] ?? /Scaled score of\s*(\d+)/.exec(t)?.[1]);

  // Blueprint table: lines like "1Prompting and Task Execution14%" or with spaces,
  // between "Content Domain" header and "Total".
  const blockMatch = /Content Domain\s*Weight([\s\S]*?)Total\s*100%/.exec(t);
  if (!blockMatch) throw new Error(`${code}: blueprint table not found`);
  const block = blockMatch[1];
  const rowRe = /(?:^|\n)\s*\d{1,2}\s*([A-Za-z][^\n%]*?)\s*(\d{1,2}(?:\.\d)?)%/g;
  const domains: { name: string; weight: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    domains.push({ name: normalize(m[1]), weight: Number(m[2]) });
  }
  if (domains.length === 0) throw new Error(`${code}: no domain rows parsed`);
  return { code, items, fee, minutes, cut, domains };
}

function sameName(a: string, b: string): boolean {
  // PDF text extraction can vary ampersand spacing/commas; compare loosely.
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return canon(a) === canon(b);
}

async function main() {
  const extracted: Extracted[] = [];
  const diffs: string[] = [];

  for (const [code, file] of Object.entries(GUIDES)) {
    const ex = await extractOne(code, file);
    extracted.push(ex);
    const fixture = EXAMS.find((e) => e.code === code)!;

    if (ex.items !== fixture.items) diffs.push(`${code}: items PDF=${ex.items} fixture=${fixture.items}`);
    if (ex.fee !== fixture.fee) diffs.push(`${code}: fee PDF=$${ex.fee} fixture=$${fixture.fee}`);
    if (ex.minutes !== fixture.minutes) diffs.push(`${code}: minutes PDF=${ex.minutes} fixture=${fixture.minutes}`);
    if (ex.cut !== 720) diffs.push(`${code}: cut PDF=${ex.cut} expected 720`);
    if (ex.domains.length !== fixture.domains.length)
      diffs.push(`${code}: domain count PDF=${ex.domains.length} fixture=${fixture.domains.length}`);

    for (const d of ex.domains) {
      const f = fixture.domains.find((fd) => sameName(fd.name, d.name));
      if (!f) diffs.push(`${code}: PDF domain "${d.name}" (${d.weight}%) missing from fixture`);
      else if (Math.abs(f.weight - d.weight) > 1e-9)
        diffs.push(`${code}: "${d.name}" weight PDF=${d.weight}% fixture=${f.weight}%`);
    }
    const wSum = ex.domains.reduce((a, d) => a + d.weight, 0);
    if (Math.abs(wSum - 100) > 1e-9) diffs.push(`${code}: PDF weights sum to ${wSum}, not 100`);
  }

  const out = path.join(__dirname, "..", "fixtures", "exams.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(extracted, null, 2));
  console.log(`Wrote ${out}`);

  if (diffs.length) {
    console.error("\nPDF ↔ fixture DIFFS (PDF wins — fix src/lib/exams.ts):");
    diffs.forEach((d) => console.error("  " + d));
    process.exit(1);
  }
  console.log("PDF extraction matches fixtures exactly. ✔");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
