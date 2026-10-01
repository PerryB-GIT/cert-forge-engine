# Report Card + Gamification Research Brief

**Date:** 2026-10-01 · **Scope:** Cert Forge (<10 adult users, 4 Anthropic partner cert exams) · **Builds on:** Sailer & Homner 2020, SDT, Dunlosky, overjustification, leaderboard paradox (already applied in Tiers 1-3, July 2026)

**Evidence labels.** *Verified* = primary text read (PDF or publisher/author page). *Snippet* = from an indexed abstract or search summary only; treat as directional.

## 1. Leaderboard design that keeps competition but limits harm

- **Competition alone is the weakest social mode; competition + collaboration the strongest.** Sailer & Homner: competitive-collaborative subsplits g = .63-.70, outperforming competition-only. *Verified.* https://d-nb.info/1202307655/34
- **Workplace boards are judged most harshly at the bottom.** Jia et al. (CHI 2017): in the productivity domain, people "had only negative perceptions of leaderboards when ranked in the bottom," fearing effects on how colleagues and employers saw them. Extraverts liked boards at every rank. Ranked activity must feel fair. *Verified.* https://stephen.voida.com/uploads/Publications/Publications/jia-chi17.pdf
- **Consent flips the sign.** Mollick & Rothbard: consented workplace games raise positive affect; unconsented ones lower it. *Snippet.* https://www.semanticscholar.org/paper/b90774010d69e3f4e198c6a5e7a6606fda601233
- **Relative boards protect low ranks.** Bai, Hew, Sailer & Jia (2021, C&E 173): absolute boards produced peer pressure for middle/bottom ranks; relative boards kept motivation similar across positions. *Snippet.* https://doi.org/10.1016/j.compedu.2021.104297
- **Low performers lose motivation on absolute boards.** Ortiz-Rojas et al. (2019). *Snippet.* https://onlinelibrary.wiley.com/doi/abs/10.1002/cae.12116
- **Long-run badges + leaderboard can underperform.** Hanus & Fox (2015), 16 weeks: lower intrinsic motivation, satisfaction, exam scores. *Snippet.* https://doi.org/10.1016/j.compedu.2014.08.019
- **A leaderboard works as a goal-setting device.** Landers, Bauer & Callan (2017): matched difficult-goal condition; depends on goal commitment. *Snippet.* https://doi.org/10.1016/j.chb.2015.08.008
- **Boards raise quantity, not intrinsic motivation.** Mekler et al. (2017). *Snippet.* https://dl.acm.org/doi/abs/10.1016/j.chb.2015.08.048
- **Board composition can hurt performance** (stereotype threat). Christy & Fox (2014). *Snippet.* https://www.sciencedirect.com/science/article/abs/pii/S0360131514001195
- **Duolingo leagues:** ~30-person cohorts, weekly reset; A/B test raised lessons started and completed. *Verified (blog).* https://blog.duolingo.com/improving-duolingo-one-experiment-at-a-time · https://www.duolingo.com/help/leaderboards-and-league

**Implication:** with <10 users a "neighbourhood" is the whole board, so rank on improvement/effort not raw score, reset weekly, opt in/out freely, and pair with a group goal.

## 2. Fair, hard-to-game ranking metrics (design analysis, not empirical)

| Metric | Gameable by | Mitigation |
|---|---|---|
| Raw items answered | Spamming easy/known items | Count only due reviews + first-attempt new items; cap per day |
| Accuracy % | Cherry-picking, re-answering seen items | First-exposure items and blind sims only |
| Minutes studied | Idle tab | Count only with an answer event every <=90 s |
| Improvement delta (sim vs own baseline) | Sandbagging the baseline | Baseline = best of first two sims; needs >=2 sims |
| Retention on due reviews | Hard to game | Best skill metric (retrieval + spacing) |
| Qualified study days | Low | Require >=N due reviews to count a day |

Compete on **retention on due reviews**, **sim improvement**, **qualified study days**. Not on raw counts or overall accuracy.

## 3. Elements with best evidence for adult learners

- **Specific, hard goals with commitment + feedback** (Locke & Latham 2002) -> weekly quests over "do your best." *Snippet.* https://eric.ed.gov/?id=EJ654871
- **Badges increase activity** (Hamari 2017, N~3,000, 2 years). *Snippet.* https://research.aalto.fi/en/publications/do-badges-increase-user-activity-a-field-experiment-on-the-effect/
- **Streaks with slack beat rigid streaks.** Duolingo: 2 equipped freezes +0.38% DAU; 7-day streak -> 3.6x course completion; Weekend Amulet -5% streak loss, +4% return; bingers abandon more than pacers. *Verified (blog).* https://blog.duolingo.com/how-duolingo-streak-builds-habit · https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/
- **Streak counters steer behaviour, sometimes badly** (GitHub streak removal study). *Verified (abstract).* https://arxiv.org/abs/2006.02371
- **Social comparison is strongest without an objective standard** (Festinger 1954). Here the 720 cut IS the standard -> make it the primary reference, not peers. https://doi.org/10.1177/001872675400700202

## 4. Learning-analytics dashboard practice

- **Jivet et al. (LAK 2018):** peer comparison brought "distress, demotivation and disappointment, especially in low-performing students"; strugglers preferred criterion- and self-referenced framing. D3 "Comparison with peers should be used cautiously." D4 "Do not assume the dashboard will have the same effect on all its users." *Verified.* https://research.ou.nl/ws/portalfiles/portal/8215481/LAK_2018_Jivet_preprint.pdf
- **Jivet et al. (EC-TEL 2017), "Awareness is not enough."** *Snippet.* https://link.springer.com/chapter/10.1007/978-3-319-66610-5_7
- **Bodily & Verbert (2017)** review of 93 student-facing dashboards. *Snippet.* https://www.semanticscholar.org/paper/1c26c12708a5383429fb26232b9d0ec6029d50cc
- **Pass-probability predictions backfire on less-motivated learners** (Valle et al. 2021). *Verified (author summary).* https://www.solaresearch.org/2022/03/dashboards-for-learners-dont-always-motivate-them/ · https://doi.org/10.1007/s11423-021-09998-z
- **Overconfidence produces underachievement** (Dunlosky & Rawson 2012) -> calibration view is useful. *Snippet.* https://doi.org/10.1016/j.learninstruc.2011.08.003

Priority visualizations: (1) domain mastery vs blueprint weight and distance to 720; (2) sim trend with readiness band (range, never a pass %); (3) calibration, confidence vs accuracy; (4) retention + upcoming due load; (5) pace per question vs time budget; (6) time on task by week. Peer percentile off by default.

## 5. Privacy norms for a small workplace/client board

- EDPB 05/2020: employer-employee consent is rarely "freely given" (power imbalance); refusal must carry no detriment; withdrawal as easy as giving. Cert Forge mixes coworkers and clients and is run by the consultant, so this applies. https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- Norms (derived): changeable self-chosen alias; opt-in per board; one-click withdrawal that also hides history; share derived metrics only, never answers or per-domain weaknesses; admin sees nothing ranked that users can't; never use board data in reviews or client reporting.

## Ranked recommendations

| # | Feature | Evidence | Risk |
|---|---|---|---|
| 1 | Domain mastery vs 720 + sim trend with readiness band | Strong | Range, not pass % |
| 2 | Calibration panel (optional 1-3 confidence tap) | Moderate | Per-item friction; keep optional |
| 3 | Weekly quests, user picks from 3 | Strong | Impossible goals backfire |
| 4 | Personal-best comparison as default | Moderate-strong | Low |
| 5 | Opt-in weekly board, 3 tabs: improvement / retention / qualified days | Moderate | n<10 -> bottom always visible; instant opt-out |
| 6 | Team goal attached to the board | Strong | Keep alongside current Scoreboard |
| 7 | Streak freezes on the consistency streak | Moderate | Never streak on raw counts |
| 8 | Tiered badges with visible next goal | Moderate | Overjustification; badge mastery not volume |
| 9 | Retention / due-load forecast | Weak-moderate | Frame as plan, not decay |
| 10 | Pace-per-question in sim review | Weak | Low |
| 11 | Opt-in head-to-head duel | Weak | Invite-only, silent decline |

## Do not do

1. No default-on ranked board; no rank numbers for non-opted-in users.
2. No ranking on raw item counts or overall accuracy.
3. No single composite leaderboard score.
4. No pass-probability percentage.
5. No peer percentile on the report card by default.
6. No board data visible to the admin beyond what users see; never used in reviews/client reporting.
7. No streak that resets to zero without a freeze path; don't reward binges.
8. No real names required.
9. No all-time cumulative board; reset weekly.
10. No gamification change without a measurement plan (ask users directly at n<10).

Excluded as unverifiable: "Leagues +25% completion", "Streak Freeze -21% churn".
