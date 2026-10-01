/**
 * Checks every URL in a docs-links.json is live (final HTTP 200
 * after redirects). Exits non-zero on any failure. Re-run before each deploy
 * that touches the links, and quarterly: docs move.
 *
 * Run: node scripts/check-doc-links.js [path/to/docs-links.json]
 *      (defaults to the sample at fixtures/questions/sample/docs-links.json)
 */
const fs = require("node:fs");
const path = require("node:path");

const file = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "fixtures", "questions", "sample", "docs-links.json");
const { exams } = JSON.parse(fs.readFileSync(file, "utf8"));

const urls = new Set();
for (const e of Object.values(exams)) {
  for (const links of Object.values(e.tasks ?? e.domains ?? {})) for (const l of links) urls.add(l.url);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

(async () => {
  let bad = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA } });
      if (res.status !== 200) {
        bad++;
        console.log(`FAIL ${res.status} ${url}`);
      }
    } catch (err) {
      bad++;
      console.log(`FAIL ${err.message} ${url}`);
    }
  }
  console.log(`${urls.size - bad}/${urls.size} links returned 200`);
  process.exit(bad ? 1 : 0);
})();
