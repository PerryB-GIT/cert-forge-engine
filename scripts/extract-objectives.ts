/**
 * Reads guides/*.pdf and extracts the published objectives for every domain,
 * writing one checked-in module per exam under src/lib/objectives/.
 *
 * Study material in Cert Forge is EXTRACTED, never authored. If it isn't in the
 * official exam guide it doesn't belong on a study sheet.
 *
 * The four guides use three different layouts, so there are three parsers:
 *
 *   flat    (CCAO-F, CCAR-P)  Domain N: Name (W%)  +  "•" bullets
 *   skills  (CCDV-F)          Domain N: Name (W%)  +  Skill Name (W%) + prose
 *   tasks   (CCAR-F)          Domain N: Name  +  Task Statement N.M  +
 *                             "Knowledge of:" / "Skills in:" bullet blocks
 *
 * Like scripts/extract-blueprint.ts, the PDF is the source of truth: domain names
 * are diffed against src/lib/exams.ts and the script exits non-zero on any
 * mismatch rather than silently writing drifted data.
 *
 * Run: npx tsx scripts/extract-objectives.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { EXAMS } from "../src/lib/exams";

type Layout = "flat" | "skills" | "tasks";

const GUIDES: Record<string, { file: string; layout: Layout }> = {
  "CCAO-F": {
    file: "Claude+Certified+Associate+–+Foundations+Exam+Guide.pdf",
    layout: "flat",
  },
  "CCDV-F": {
    file: "Claude+Certified+Developer+–+Foundations+Exam+Guide.pdf",
    layout: "skills",
  },
  "CCAR-F": {
    file: "Claude+Certified+Architect+–+Foundations+Exam+Guide.pdf",
    layout: "tasks",
  },
  "CCAR-P": {
    file: "Claude+Certified+Architect+–+Professional+Exam+Guide.pdf",
    layout: "flat",
  },
};

/** One coherent chunk of study material inside a domain. */
type Group = {
  /** Task-statement or skill name. Null when the guide lists bare bullets. */
  title: string | null;
  /** Skill weight as a share of the whole exam (CCDV-F only). */
  weight: number | null;
  /** Prose description (CCDV-F only). */
  summary: string | null;
  /** "Knowledge of:" bullets (CCAR-F only). */
  knowledge: string[];
  /** "Skills in:" bullets (CCAR-F only). */
  skills: string[];
  /** Ungrouped bullets (CCAO-F / CCAR-P). */
  points: string[];
};

type DomainObjectives = { domain: string; groups: Group[] };

const ROOT = path.join(__dirname, "..");

/** Page furniture that pdf-parse interleaves into the body text. */
const NOISE =
  /^(Claude Certification Program\s*Exam guide|--\s*\d+\s*of\s*\d+\s*--|\s*)$/;

const SECTION_HEADING = /^\d{1,2}\.\s+[A-Z]/;
const DOMAIN_HEADING = /^Domain\s+(\d{1,2}):\s*(.+?)\s*(?:\((\d{1,2}(?:\.\d)?)%\))?$/;
const TASK_HEADING = /^Task Statement\s+\d{1,2}\.\d{1,2}:\s*(.*)$/;
const SKILL_HEADING = /^(.+?)\s*\((\d{1,2}(?:\.\d)?)%\)$/;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Re-join a line that the PDF wrapped. When the break fell on a hyphen
 * ("Anthropic-\nhosted", "trade-\noffs") the two halves close up with no space;
 * everything else gets one.
 */
function joinWrapped(prev: string, next: string): string {
  const tail = clean(next);
  if (!prev) return tail;
  return /[A-Za-z]-$/.test(prev) ? prev + tail : `${prev} ${tail}`;
}

async function guideLines(file: string): Promise<string[]> {
  const buf = fs.readFileSync(path.join(ROOT, "guides", file));
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const { text } = await parser.getText();
  await parser.destroy();
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/ /g, " ").trimEnd())
    .filter((l) => !NOISE.test(l.trim()));
}

/** Slice from the first "Domain 1:" to the next top-level numbered section. */
function objectiveBlock(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^Domain\s+1:/.test(l.trim()));
  if (start === -1) throw new Error("no 'Domain 1:' heading found");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_HEADING.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/** Split an objective block into one chunk of lines per domain. */
function splitDomains(block: string[]): { name: string; body: string[] }[] {
  const out: { name: string; body: string[] }[] = [];
  for (const raw of block) {
    const m = DOMAIN_HEADING.exec(raw.trim());
    if (m) out.push({ name: clean(m[2]), body: [] });
    else if (out.length) out[out.length - 1].body.push(raw);
  }
  return out;
}

function emptyGroup(title: string | null): Group {
  return { title, weight: null, summary: null, knowledge: [], skills: [], points: [] };
}

/**
 * Collect "•" bullets, folding wrapped continuation lines back onto the bullet
 * they belong to.
 */
function collectBullets(body: string[]): string[] {
  const bullets: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line.startsWith("•")) bullets.push(clean(line.slice(1)));
    else if (bullets.length)
      bullets[bullets.length - 1] = joinWrapped(bullets[bullets.length - 1], line);
  }
  return bullets;
}

function parseFlat(body: string[]): Group[] {
  const bullets = collectBullets(body);
  if (bullets.length === 0) return [];
  const g = emptyGroup(null);
  g.points = bullets;
  return [g];
}

function parseSkills(body: string[]): Group[] {
  const groups: Group[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const m = SKILL_HEADING.exec(line);
    // A skill heading is a short "Name (W%)" line; prose never ends that way.
    if (m && m[1].length < 70) {
      const g = emptyGroup(clean(m[1]));
      g.weight = Number(m[2]);
      groups.push(g);
    } else if (groups.length) {
      const g = groups[groups.length - 1];
      g.summary = joinWrapped(g.summary ?? "", line);
    }
  }
  return groups;
}

function parseTasks(body: string[]): Group[] {
  const groups: Group[] = [];
  let bucket: "knowledge" | "skills" | null = null;
  let titleOpen = false;

  const isBoundary = (l: string) =>
    TASK_HEADING.test(l) || /^Knowledge of:/.test(l) || /^Skills in:/.test(l);

  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;

    const t = TASK_HEADING.exec(line);
    if (t) {
      groups.push(emptyGroup(clean(t[1])));
      bucket = null;
      // A task statement's title can wrap onto the following line.
      titleOpen = true;
      continue;
    }
    if (!groups.length) continue;
    const g = groups[groups.length - 1];

    if (/^Knowledge of:/.test(line)) {
      bucket = "knowledge";
      titleOpen = false;
      continue;
    }
    if (/^Skills in:/.test(line)) {
      bucket = "skills";
      titleOpen = false;
      continue;
    }

    if (line.startsWith("•")) {
      titleOpen = false;
      (bucket === "skills" ? g.skills : g.knowledge).push(clean(line.slice(1)));
      continue;
    }

    if (titleOpen && !isBoundary(line)) {
      g.title = joinWrapped(g.title ?? "", line);
      continue;
    }

    // Wrapped continuation of the previous bullet.
    const list = bucket === "skills" ? g.skills : g.knowledge;
    if (list.length) list[list.length - 1] = joinWrapped(list[list.length - 1], line);
  }
  return groups;
}

const PARSERS: Record<Layout, (body: string[]) => Group[]> = {
  flat: parseFlat,
  skills: parseSkills,
  tasks: parseTasks,
};

function moduleSource(code: string, domains: DomainObjectives[]): string {
  return `// GENERATED by scripts/extract-objectives.ts from
// guides/${GUIDES[code].file}
// Do not edit by hand - re-run the script instead.
import type { DomainObjectives } from "../objectives";

const OBJECTIVES: DomainObjectives[] = ${JSON.stringify(domains, null, 2)};

export default OBJECTIVES;
`;
}

async function main() {
  const outDir = path.join(ROOT, "src", "lib", "objectives");
  fs.mkdirSync(outDir, { recursive: true });

  const problems: string[] = [];
  const summary: string[] = [];

  for (const exam of EXAMS) {
    const { file, layout } = GUIDES[exam.code];
    const lines = await guideLines(file);
    const chunks = splitDomains(objectiveBlock(lines));

    // The PDF is the source of truth: its domain list must match exams.ts exactly.
    const got = chunks.map((c) => c.name);
    const want = exam.domains.map((d) => d.name);
    if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
      problems.push(
        `${exam.code}: domain mismatch\n  guide:    ${JSON.stringify(got)}\n  exams.ts: ${JSON.stringify(want)}`
      );
      continue;
    }

    const domains: DomainObjectives[] = chunks.map((c) => ({
      domain: c.name,
      groups: PARSERS[layout](c.body),
    }));

    const empty = domains.filter((d) => d.groups.length === 0).map((d) => d.domain);
    if (empty.length) problems.push(`${exam.code}: no objectives parsed for ${JSON.stringify(empty)}`);

    const bullets = domains.reduce(
      (n, d) =>
        n +
        d.groups.reduce((m, g) => m + g.points.length + g.knowledge.length + g.skills.length, 0),
      0
    );
    const file_ = path.join(outDir, `${exam.code.toLowerCase()}.ts`);
    fs.writeFileSync(file_, moduleSource(exam.code, domains), "utf8");
    summary.push(
      `${exam.code.padEnd(7)} ${layout.padEnd(7)} ${String(domains.length).padStart(2)} domains  ` +
        `${String(domains.reduce((n, d) => n + d.groups.length, 0)).padStart(3)} groups  ` +
        `${String(bullets).padStart(4)} bullets  -> ${path.relative(ROOT, file_)}`
    );
  }

  console.log(summary.join("\n"));
  if (problems.length) {
    console.error("\nEXTRACTION PROBLEMS:\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("\nAll four guides parsed; domain names match src/lib/exams.ts exactly.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
