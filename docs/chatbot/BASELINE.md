# Chatbot Workstream Baseline

Recorded on 2026-09-08 before any chatbot runtime, migration, application, or Edge Function change.

## Source integrity

- Frozen integration base: `489b8c7fb101794bc2af33a3df2bea44a242d43a`
- Implementation branch at baseline: `workstream/chatbot`
- Baseline branch tip: `5011c34dcc6fe4aba8d62e4fd2caa1d54eb67985`
- Commits after the frozen base were only the four approved chatbot documentation commits.
- `git diff --name-only 489b8c7fb101794bc2af33a3df2bea44a242d43a..5011c34dcc6fe4aba8d62e4fd2caa1d54eb67985` contained only `docs/` paths.

## Existing test behavior

The first full `npm test` run reported 280 passing tests, two timeouts, and one suite setup failure.

### Parallel-worker timeout/flakiness

1. `src/components/clubs/ClubForms.test.jsx > ClubFormDialog > creates a club with multiple weekly schedule rules`
   - Full-suite result: timed out at 5,000 ms.
   - Sequential focused rerun: passed; 1 passed, 3 skipped; test execution 555 ms.
2. `src/components/orders/OrderConfirmationPDF.test.jsx > OrderConfirmationPDF recipient email > shows a valid recipient in compact mode by default`
   - Full-suite result: timed out at 5,000 ms.
   - Sequential focused rerun: passed; 1 passed, 8 skipped; test execution 306 ms.

These are treated as existing full-suite parallel-worker timeout/flakiness. If either test later fails with a different assertion or error, it is a regression until proven otherwise.

### Environment/setup issue

`src/components/quotes/QuotePDFDocument.product.test.jsx` fails during module import when `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is unavailable:

```text
Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env
```

The focused suite passed with non-secret local test values:

```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY='baseline-test-key'
npm test -- src/components/quotes/QuotePDFDocument.product.test.jsx
```

Result: 1 test passed. This is an environment/setup issue, not a chatbot failure.

## Existing lint baseline

`npm run lint` reports seven errors before chatbot implementation:

- `src/components/Layout.jsx`: unused `X` import.
- `src/pages/Dashboard.jsx`: unused `Mail` and `Link` imports.
- `src/pages/Leads.jsx`: unused `Badge` import.
- `src/pages/Products.jsx`: conditional `useEffect`.
- `src/pages/Templates.jsx`: conditional `useEffect`.
- `src/pages/Users.jsx`: conditional `useEffect`.

Chatbot work will not modify unrelated files solely to clear these failures. Touched chatbot files must add no lint errors, and the baseline count must not increase.

## Existing typecheck baseline

`npm run typecheck` fails before chatbot implementation with existing diagnostics, including parsing/type errors under `node_modules/punycode`, missing `ImportMeta.env` typing, Radix wrapper prop inference, existing form/page typing, and existing `OrderConfirmationPDF`/Orders/Quotes diagnostics.

Chatbot work will not disable or relax type checking. New chatbot files must produce no attributable diagnostics, and existing diagnostics must not increase or change because of chatbot work.

## Existing build baseline

`npm run build` passes when the same non-secret local Supabase values are present. The only output is the existing Browserslist age notice.

## Workstream verification policy

- Every chatbot-specific test must pass.
- New or touched chatbot files must be lint-clean.
- New or touched chatbot files must introduce no TypeScript diagnostics.
- The production build must pass.
- Full-suite failures may match only the exact baseline above; any new or changed failure is a regression.
- No test skipping, broad ignore, disabled type checking, relaxed authentication, or weakened RLS is permitted.
