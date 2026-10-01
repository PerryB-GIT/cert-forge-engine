/**
 * Run SQL against the Cert Forge Supabase project through the Management API
 * (no direct Postgres connection, no CA cert needed).
 *
 *   CF_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/cf-db.js <file.sql> [--dry-run] [--read-only]
 *   CF_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/cf-db.js -e "select 1"
 *
 * --dry-run rewrites a trailing `commit;` to `rollback;`, so a migration is
 * compiled and executed end to end, then discarded. Keep the token in a
 * secret store or your shell environment; never commit it.
 */
const fs = require("fs");

// Required: the Supabase project ref (the subdomain of your project URL).
const PROJECT = process.env.CF_PROJECT_REF;

async function runSql(query, { readOnly = false } = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  if (!PROJECT) throw new Error("CF_PROJECT_REF is not set (your Supabase project ref)");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text}`);
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

module.exports = { runSql };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let sql;
    if (args[0] === "-e") sql = args[1];
    else sql = fs.readFileSync(args[0], "utf8");
    if (args.includes("--dry-run")) {
      const replaced = sql.replace(/commit;\s*$/i, "rollback;");
      if (replaced === sql) throw new Error("--dry-run needs the file to end with `commit;`");
      sql = replaced;
    }
    const rows = await runSql(sql, { readOnly: args.includes("--read-only") });
    console.log(JSON.stringify(rows, null, 2));
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
