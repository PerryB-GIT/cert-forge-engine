# Cert Forge (engine)

Cert Forge is a study tracker and exam simulator for certification exams. It has blueprint-weighted mock exams,
spaced-repetition practice, flashcards for missed items, per-domain study sheets, a report card and an opt-in leaderboard.
It was built to prepare a small group for the Claude certification exams.

This repository contains **the code only**: the app, the database functions and migrations, the scripts and the
tests. It does **not** include the real question banks or any text from the exam guides (see
[What is not included](#what-is-not-included)). An original 8-question sample bank is included so the test suite and
the source-link feature have something to run against.

Cert Forge is an independent study tool from Support Forge. It is **not affiliated with, endorsed by, or sponsored by
Anthropic** (or Pearson VUE). "Claude" is a trademark of Anthropic. The exam codes, names, domain names and weights in
`src/lib/exams.ts` are only the public blueprint facts the scorer needs.

---

## Architecture

- **Next.js 16 App Router.** `src/proxy.ts` (the Next 16 replacement for `middleware.ts`) refreshes the Supabase
  session cookie on every request and sends signed-out users to `/login`. Pages are thin clients over RPCs.
- **Supabase.** Sign-in is anonymous. A durable identity sits on top as a username plus a bcrypt-hashed PIN
  (`cf_credentials`). A device that loses its session can reclaim its history with `cf_claim_profile`.
- **All logic runs server-side in Postgres.** Drawing items, grading, scoring, scheduling, badges, quests and
  leaderboard aggregation are `SECURITY DEFINER` functions with a pinned `search_path`. The client reads only its own
  rows in a few tables through RLS policies (`auth.uid() = user_id`). Questions and keys are reached only through
  RPCs. No client select policy exists on `cf_questions`, `cf_invites`, `cf_holdout` or `cf_question_tasks`. The
  browser sees an answer key only after the server grades an item the user has already answered.
- **TypeScript domain logic** in `src/lib/` (scoring, readiness, report card, leaderboard, missed-item status) mirrors
  the SQL where the UI needs it, and has unit tests (`*.test.ts`, Vitest).

```
src/app/            routes: simulate, practice, flashcards, missed, study, report, leaderboard, results, login ...
src/components/     players (ExamPlayer, PracticePlayer, FlashcardPlayer), charts, report card panels
src/lib/            scoring, exams blueprint, objectives loader (+ stubs), sources, leaderboard, report, tests
src/proxy.ts        auth gate
scripts/sql/        dated migrations + a live schema snapshot
scripts/            seeding, bank-maintenance tools, verification harnesses
fixtures/questions/sample/   original sample bank + sample source data
docs/               gamification research brief
```

## Methodology highlights

### Fresh-item scoring with a margin (`src/lib/scoring.ts`, `2026-09-25-fresh-verdict.sql`)
Retaking a mock exam stops measuring readiness once you have seen the keys. Each sim records which items were
**unseen when it was drawn** (`fresh_ids`). Readiness is scored only on those fresh items, pooled across recent sims
(`cf_readiness`). A verdict needs at least 40 fresh items and coverage of every blueprint domain.

Every score has a **90% binomial margin**: `1.645 × sqrt(p(1−p)/n) × 900` scaled points. At n=60 and about 80% correct
that is roughly ±76 points, and the UI shows it.

### Readiness bands
The vendor does not publish how its scaled score maps to percent correct. The linear `100 + 9 × pct` mapping
(720 ≈ 69%) is an explicit assumption, so a practice score is read as a band, not a verdict:

| Band | Rule |
|---|---|
| Likely pass | 800+ **and** the low end of the 90% margin still clears 720 |
| Borderline | 720 or more |
| Not yet | below 720 |

Domain weighting is renormalised only over the domains present. Because of that, the sim draw is **stratified by
blueprint weight with a floor of one item per domain** (`2026-08-07-stratified-sim-draw.sql`). Otherwise a domain that
drew zero items would silently drop out of the score instead of counting as zero.

### Answer-giveaway "tell" gates (`src/lib/question-bank.test.ts`)
The banks are the product, so the tests gate the banks themselves, not just the code around them. Each gate came from
a real defect:
- **Key position.** No answer position may hold more than 40% of keys, and every position must be used. A blind
  "always A" or "top-N" run must score far below the cut.
- **Length.** The key may not be reliably the longest, the shortest or the second-longest option. "Pick the longest"
  must score under 600. The comments show how each threshold is derived from the scaled-score formula, so the limits
  are not arbitrary.
- **Odd format.** Among items where exactly one option has a marker (comma, semicolon, colon, "because", quotes,
  digits, parentheses or "e.g."), that option must be neither reliably the key (over 40%) nor reliably not the key
  (under 8%). Trailing punctuation must agree within an item.
- **Structure.** Each bank must be at least 1.5× the exam length so a retake is not the same paper. Every blueprint
  domain must be able to fill its quota. Each authoring batch is checked for its own length lean. Holdout forms and
  task-statement tags are checked for consistency.

With no real banks present, the gates run against the sample bank. The gates that need real-only fixtures are skipped,
and the skip message says why.

### Leitner scheduler
Practice and flashcard grading move each item through Leitner boxes (`cf_box_interval`: 10 min, 1 day, 3, 7, 16 and
35 days). A miss drops the item back to box 0. The practice draw orders items as due reviews first, then unseen items,
then the rest (`2026-08-05-practice-scheduler-order.sql`). The "missed" view separates *shaky* items from *recovered*
ones (`src/lib/missed.ts`).

### Verification harnesses (`scripts/verify-*.js`)
Database changes are proven against the real database without leaving anything behind:
- `verify-gamification.js` and `verify-invite-gate.js` run the whole check as **one transaction that always ends by
  raising a sentinel exception**. The results are carried out in the exception message. Postgres rolls everything
  back, including throwaway `auth.users` rows, sessions, answers and invites, even when every check passes. A run that
  does not raise the sentinel is treated as untrustworthy. `--with-migration` prepends an unapplied migration so it
  can be proven **before** it is applied.
- RPCs are called as `authenticated` with `request.jwt.claims` set, so `auth.uid()`, grants and RLS behave as they do
  for the browser.
- The older harnesses (`verify-identity.js`, `verify-sim-draw.js`, `verify-study-lab.js`) connect over `pg`. They use
  a throwaway user with per-check rollbacks and a `finally` block that deletes everything the user created.
- `scripts/cf-db.js --dry-run` rewrites a migration's trailing `commit;` to `rollback;`, so it compiles and executes
  end to end, then is discarded.

### Invite gate (`2026-10-01c-invite-gate.sql`)
Anonymous sign-in plus a client-insertable profile meant anyone could start practice sets and read every answer key
through the grading RPCs. That made it possible to harvest a whole bank with a script. The gate fixes this in four
ways:
- A profile can now be created only by `cf_join`, which needs an invite code, or by `cf_claim_profile`, which needs
  an existing username and PIN.
- Starting any session requires a profile, enforced by a trigger, so every answer-revealing RPC is gated.
- Invite codes are stored only as SHA-256 hashes with a use counter.
- A sealed go/no-go holdout form can be sat only once per user.

### Gamification and leaderboard
The design follows a research brief, [`docs/gamification-research.md`](docs/gamification-research.md). Its main
findings: competition alone is weak, bottom ranks on absolute boards demotivate, consent changes the effect, and
badges should reward mastery, not volume.

The resulting design:
- The leaderboard is **opt-in, with an optional alias**.
- It **resets weekly** and ranks on **improvement against your own baseline, retention on due reviews and
  consistency (qualified days)**, not raw volume. Every metric is hardened against the obvious exploits, such as
  blank-sim farming, sandbagging a baseline or spamming known items.
- There is a **shared team goal** and weekly quests.
- All aggregation happens in SECURITY DEFINER functions that expose only opted-in members.

## Setup

1. **Install:** `npm ci`
2. **Environment:** `cp .env.example .env.local` and fill in your values. The app needs `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key, never a service-role key) at build time and at run time.
   The scripts read the other variables.
3. **Supabase project:** create a project and enable **anonymous sign-ins** (Authentication → Providers). The
   migrations use the `pgcrypto` extension (`crypt`, `gen_salt`, `digest`) in the `extensions` schema.
4. **Schema — an honest note.** The base schema is **not** captured as clean migrations.
   `scripts/sql/live-baseline-2026-10-01.sql` is a snapshot of the live `cf_` objects:
   - The functions are included as runnable `CREATE OR REPLACE`.
   - The constraints, RLS policies, triggers and grants are listed as **comments only**.
   - The core tables (`cf_exams`, `cf_domains`, `cf_questions`, `cf_profiles`, `cf_exam_sessions`, `cf_attempts`,
     `cf_item_reviews`, `cf_practice_sessions`, `cf_chronicle`, `cf_achievements`, ...) have no `CREATE TABLE`.
   - The secret-gated `cf_seed_questions` RPC is omitted.

   To stand up a fresh database:
   1. Write the base tables from the commented constraints and the column usage in the functions.
   2. Apply the snapshot's functions.
   3. Apply the dated migrations in `scripts/sql/` **in filename (date) order**. Each one is idempotent
      (`create ... if not exists`, `create or replace`).
   4. Write a `cf_seed_questions(p_secret, p_bank)` that checks the secret against `cf_seed_secret` and upserts the
      bank.

   `node scripts/cf-db.js <file.sql> --dry-run` proves each step before you apply it.
5. **Seed a bank:**
   1. Insert the exam and its domains into `cf_exams` and `cf_domains`.
   2. Run `node scripts/seed-questions.js path/to/bank.json` (or an exam code, which reads
      `fixtures/questions/<CODE>.json`).
   3. To try the sample, add `SAMPLE_EXAM` from `src/lib/sample-exam.ts` to `EXAMS`, insert matching
      `DEMO-F` rows, and seed `fixtures/questions/sample/SAMPLE.json`.

   The bank schema is `{ exam_code, questions: [{ id, domain, scenario, multi, select_count, stem, options[],
   correct[], rationale: { overall, options[] }, tip }] }`. Run `npx vitest run` before seeding: the tell gates apply
   to any bank you add at `fixtures/questions/<CODE>.json`.
6. **Invites:** insert `encode(digest(upper('<YOUR-CODE>'), 'sha256'), 'hex')` into `cf_invites`
   (`code_hash`, `label`, `uses_left`). Keep the plaintext code out of the repo.
7. **Run:** `npm run dev`

### Checks
```
npm run typecheck     # next typegen && tsc --noEmit (route types are generated by Next)
npx vitest run        # unit tests + bank tell gates (runs on the sample bank in a fresh clone)
npm run lint
npx next build        # needs NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY set (placeholders work for a build)
```

### Container
The `Dockerfile` builds a standalone Next.js image that listens on `$PORT` (default 8080). Pass the public Supabase
config as build args: `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .`

## What is not included

- **Real question banks:**
  - Not included: the banks themselves, the authoring batches, distractor and key patches, task tags, holdout forms,
    key permutations and the per-exam seed SQL.
  - Why: they are answer keys. Publishing them would defeat the tool and the invite gate, and could expose live exam
    content.
  - Still included: the tooling around them (`merge-question-batch.js`, `patch-*.js`, `rebalance-keys.js`,
    `migrate-stored-answers.js`, `emit-question-sql.js`, `seed-holdout.js`, `seed-tasks.js`). These scripts expect
    those fixture files to be present.
- **Exam-guide text:**
  - Not included: the guide PDFs, the objectives extracted from them (`src/lib/objectives/<code>.ts` are stubs; see
    `src/lib/objectives/stub.ts`), the guide page map, and the curated per-task study links.
  - Why: the guides belong to their publisher and are distributed through a partner programme, so their text is not
    redistributed here.
  - To regenerate from your own licensed copies, put the PDFs in `guides/`, which is gitignored, then run:
    - `npx tsx scripts/extract-objectives.ts`
    - `npx tsx scripts/extract-guide-pages.ts`
    - `npx tsx scripts/extract-blueprint.ts`
  - `src/lib/sources.ts` is wired to the sample source data under `fixtures/questions/sample/`. Point it at your own
    files to wire up a real bank.
- **Deployment configuration and identifiers:** project refs, keys, service URLs, invite codes and internal planning
  documents are not included.

No license file is included. All rights reserved unless the owner states otherwise.
