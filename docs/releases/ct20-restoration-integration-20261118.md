# CT20 + functionality restoration integration candidate — 18 November 2026

This is an isolated, unmerged review branch. It starts at restoration commit
`e2140c1d3cd20ee2ce85516c78ba7c361ab9b6de` and cherry-picks the CT20
commits as `db7235b`, `b51f53b`, `775f231`. The source branches and Production
deployment were not changed. The two workstreams changed no overlapping file
paths relative to deployed source `73690eee338b400bd9310e8fb283806852f43f29`;
the cherry-picks applied without conflicts.

## Independent UI candidate

Branch `codex/checkout-ui-only-20261118`, commit `db2021c`, also starts at the
deployed source. It changes only `PaymentScreen.jsx` and two UI tests. It
groups payment methods and shows the selected amount/action on the explicit
confirmation button. It changes no API, worker, migration, gate, transaction,
or accounting ledger code. This is the release candidate for checkout UI
without the Direct J4 backend change. Focused UI regression: 18/18 passed;
build and changed-file lint passed.

## Combined verification

- Physical and hosted server tests: 84/84 passed.
- Full-schema rehearsal: 103 migrations, zero unvalidated; digital order,
  cash collection, physical remaining balance, hosted document association,
  and direct first-response scenarios passed.
- Vite build: passed.
- Full Vitest suite in the restricted process sandbox: 1,276/1,281 passed;
  the only five failures were real-PDF tests that could not launch local
  Chrome (`Code: 2147483651`). The same PDF test file passed 9/9 with browser
  process permission, including those five tests. This establishes a test
  environment limitation, not a PDF assertion failure.
- `npm run typecheck`: 178 errors, beginning in `node_modules/punycode`.
  The UI-only Production-base branch has the same 178 errors and first errors;
  this is an existing gate failure, not a new passing check.
- `npm audit --omit=dev`: Production-base lockfile: 13 high, 13 moderate;
  initial combined lockfile: 15 high, 13 moderate. The two added high
  findings were `puppeteer-core` and `chromium-bidi`, introduced via
  restoration's PDF dependency. This integration candidate alone upgrades
  `puppeteer-core` from 25.11.0 to 25.18.1. The post-update audit is back to
  the Production-base count of 13 high and 13 moderate, with neither new
  Puppeteer finding present. Post-update real-PDF tests passed 9/9 and the
  Vite build passed. The source restoration branch is untouched.

## Release gates

The UI-only branch can be reviewed independently for a normal Production
release. Its existing 13 high dependency findings require the release owner's
usual security disposition, but this branch adds no dependency or financial
behavior. No deployment is authorized by this document.

The combined backend branch is not ready for Production: obtain a live
Pelecard `GetTransDetailsEMV` sample confirming UID, transaction, approval,
register, terminal, amount and currency field mapping; establish ParamX
compatibility; review the focused Puppeteer upgrade and the full integration
regression result. ORD-1062 remains a separate approval-gated
financial correction and must not be completed by deployment.
