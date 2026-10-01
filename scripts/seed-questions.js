/**
 * Seeds question banks into cf_questions via the secret-gated cf_seed_questions RPC.
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / CF_SEED_SECRET from .env.local.
 * Usage: node scripts/seed-questions.js [EXAM_CODE | path/to/bank.json ...]
 *   An EXAM_CODE reads fixtures/questions/<EXAM_CODE>.json; a .json path is read
 *   as-is (e.g. fixtures/questions/sample/SAMPLE.json). The bank's exam_code and
 *   every question's domain must already exist in cf_exams / cf_domains.
 */
const fs = require("fs");
const path = require("path");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const codes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["CCAO-F", "CCDV-F", "CCAR-F", "CCAR-P"];

(async () => {
  for (const code of codes) {
    const file = code.endsWith(".json")
      ? path.resolve(code)
      : path.join(__dirname, "..", "fixtures", "questions", `${code}.json`);
    if (!fs.existsSync(file)) {
      console.log(`skip ${code} (no file)`);
      continue;
    }
    const bank = JSON.parse(fs.readFileSync(file, "utf8"));
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/cf_seed_questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_secret: env.CF_SEED_SECRET, p_bank: bank }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`${code}: FAILED ${res.status} ${body}`);
      process.exitCode = 1;
    } else {
      console.log(`${code}: seeded ${body} questions`);
    }
  }
})();
