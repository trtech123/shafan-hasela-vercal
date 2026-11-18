# Read-only Pelecard administration release group — 2026-11-18

This branch adds only an administrator transaction list on top of the operational restoration branch. The protected `app/server/pelecard-transactions` route and all payment, refund, cash, Direct J4 and Payper sources remain unchanged. No provider request was sent for this review.

Read-only production inspection confirmed that the Vercel `PELECARD_RETRIEVAL_ENABLED` gate is true and `PELECARD_RETRIEVAL_SCOPE_ID` is populated. The candidate does not change either setting. The route enforces admin authentication, a fixed terminal scope, bounded date range and provider response allowlisting. The UI exposes no mutation action. Live provider retrieval and authorized admin acceptance still require a controlled read-only Preview/Production check by the release coordinator; this must not be combined with the unresolved CT20 payment investigation.

Local verification: the protected route's 13 Node tests passed, the focused UI/navigation/client suite passed 24/24, and the production Vite build passed. These tests use mocked provider data. This branch is ready for controlled Preview acceptance, not automatic Production deployment.
