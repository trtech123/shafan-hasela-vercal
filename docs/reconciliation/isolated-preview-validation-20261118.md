# Isolated Preview validation — 2026-11-18

## Remote Preview safety gate

Read-only inspection of Vercel project `shafan-hasela-vercal` found five variables assigned to Preview. They include `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID` and `META_WABA_ID`. These are shared with Production rather than scoped to an isolated branch or test project. Therefore **no Vercel Preview was deployed or used for role testing**. A safe remote Preview needs its own Supabase project/data, role accounts and isolated environment values. It must not inherit live financial or messaging credentials.

## Local browser rehearsal

Vite was started on `127.0.0.1:4177` with `VITE_SUPABASE_URL=https://preview-synthetic.supabase.co` and a synthetic public key. `app/scripts/isolated-preview-ui.cjs` intercepts all requests to that synthetic host and responds from in-memory records; every other external origin is blocked, including image, font and calendar assets. The script uses Playwright through the local Playwright skill runner. The optional `--pelecard` mode is for the separate read-only administration candidate and was not used on this branch. It makes no Production request, provider call or database write.

Observed in a real Chromium browser with React Router and the application UI:

- Admin: create, edit, search and archive a synthetic customer; create a manual club session; mark attendance.
- Cashier: open customer management; cannot archive; direct route to admin attendance redirects to the schedule.
- Linked instructor: open own session/roster and mark synthetic attendance; direct customer-management route is denied.

The first run exposed a login race: successful sign-in navigated before the asynchronous profile lookup finished, allowing a redirect back to Login that then persisted. `Login.jsx` now navigates when `isAuthenticated` becomes true. A regression test failed before the fix and passed afterward; the browser rehearsal then passed.

These results verify browser behavior with synthetic service responses. They do **not** prove Production RLS or an actual remote Preview account. Live RPC/RLS signatures and grants were inspected separately, read-only, in `operational-release-20261118.md`.
