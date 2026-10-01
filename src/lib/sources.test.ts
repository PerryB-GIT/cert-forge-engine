import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sourceFor, examOf, guideFile } from "./sources";
import docsLinks from "../../fixtures/questions/sample/docs-links.json";
import guidePages from "../../fixtures/questions/sample/guide-pages.json";

/**
 * Every item a learner can miss must be able to say where it comes from: a
 * guide page, and for tagged exams its task statement.
 *
 * sources.ts reads whichever source data it is wired to (in this repository,
 * the original DEMO-F sample under fixtures/questions/sample/). These tests run
 * every exam that data covers against that exam's bank: the sample bank always,
 * plus any real bank present at fixtures/questions/<CODE>.json.
 */

type Item = { id: string; domain: string };
const QDIR = path.join(process.cwd(), "fixtures", "questions");
const PAGES = guidePages as Record<string, { file: string; domains: Record<string, number>; tasks: Record<string, number> }>;
const CODES = Object.keys(PAGES);

function bankFile(code: string): string | null {
  const real = path.join(QDIR, `${code}.json`);
  if (fs.existsSync(real)) return real;
  const sample = path.join(QDIR, "sample", "SAMPLE.json");
  const raw = JSON.parse(fs.readFileSync(sample, "utf8"));
  return raw.exam_code === code ? sample : null;
}

function bank(code: string): Item[] {
  const raw = JSON.parse(fs.readFileSync(bankFile(code)!, "utf8"));
  return raw.questions ?? raw;
}

function tags(code: string): Record<string, string> | null {
  for (const f of [path.join(QDIR, "tags", `${code}.json`), path.join(QDIR, "sample", "tags.json")]) {
    if (!fs.existsSync(f)) continue;
    const t = JSON.parse(fs.readFileSync(f, "utf8"));
    if (t.exam_code === code) return t.items;
  }
  return null;
}

const ALLOWED_HOSTS = [
  "platform.claude.com",
  "docs.claude.com",
  "docs.anthropic.com",
  "support.claude.com",
  "support.anthropic.com",
  "www.anthropic.com",
  "anthropic.com",
  "anthropic.skilljar.com",
  "modelcontextprotocol.io",
  "code.claude.com",
  // Used by the DEMO-F sample's general-software tasks only.
  "aws.amazon.com",
  "martinfowler.com",
];

describe("item sources", () => {
  it("source data covers at least one exam that has a bank", () => {
    expect(CODES.filter((c) => bankFile(c)).length).toBeGreaterThan(0);
  });

  for (const code of CODES) {
    it.skipIf(!bankFile(code))(`${code}: every item resolves to a guide page`, () => {
      const t = tags(code);
      for (const q of bank(code)) {
        const s = sourceFor(q.id, q.domain);
        expect(s, q.id).not.toBeNull();
        expect(s!.exam).toBe(code);
        expect(s!.guidePage).toBeGreaterThan(0);
        expect(s!.guideHref).toBe(`/api/guide/${code}#page=${s!.guidePage}`);
        if (t?.[q.id]) expect(s!.task?.id, q.id).toBe(t[q.id]);
        expect(s!.docs.length, `${q.id} has no study links`).toBeGreaterThan(0);
      }
    });
  }

  it("parses exam codes from item ids", () => {
    expect(examOf("CCAR-F-S4-07")).toBe("CCAR-F");
    expect(examOf("CCDV-F-D1-01")).toBe("CCDV-F");
    expect(examOf("DEMO-F-D1-01")).toBe("DEMO-F");
    expect(examOf("nonsense")).toBeNull();
  });

  it("unknown exam or domain yields no source rather than a wrong one", () => {
    expect(sourceFor("CCZZ-F-D1-01", "Anything")).toBeNull();
    // An untagged item falls back to its domain, so an unknown domain must give null.
    expect(sourceFor("DEMO-F-D9-99", "Not A Domain")).toBeNull();
  });

  it("every exam maps to a guide file name", () => {
    for (const code of CODES) expect(guideFile(code), code).toBeTruthy();
  });

  // The guide PDFs are not distributed with this repository; when a guides/
  // folder is present (a licensed local copy), every mapped file must exist.
  it.skipIf(!fs.existsSync(path.join(process.cwd(), "guides")))(
    "every mapped guide file exists in guides/ (skipped: no guides/ folder)",
    () => {
      for (const code of CODES) {
        const f = guideFile(code)!;
        expect(fs.existsSync(path.join(process.cwd(), "guides", f)), f).toBe(true);
      }
    }
  );
});

describe("docs-links.json", () => {
  const exams = (docsLinks as { exams: Record<string, { tasks?: object; domains?: object }> }).exams;

  it("keys match real task statements / domains, with no empty lists", () => {
    for (const code of CODES) {
      const e = exams[code];
      expect(e, code).toBeTruthy();
      const keyed = (e.tasks ?? e.domains) as Record<string, unknown[]>;
      const valid = e.tasks ? PAGES[code].tasks : PAGES[code].domains;
      expect(Object.keys(keyed).sort(), code).toEqual(Object.keys(valid).sort());
      for (const [k, links] of Object.entries(keyed)) expect(links.length, `${code} ${k}`).toBeGreaterThan(0);
    }
  });

  it("links are https and on allow-listed hosts only", () => {
    for (const e of Object.values(exams)) {
      const all = Object.values((e.tasks ?? e.domains) as Record<string, { url: string }[]>).flat();
      for (const l of all) {
        const u = new URL(l.url);
        expect(u.protocol, l.url).toBe("https:");
        expect(ALLOWED_HOSTS, l.url).toContain(u.hostname);
      }
    }
  });
});
