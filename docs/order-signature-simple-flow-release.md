# Simple order confirmation signature flow

Released October 11, 2026. This correction supersedes the billing prerequisite described in `order-signature-billing-finalization.md`. Customer billing remains a separate workflow; it is not required to prepare or sign a confirmation.

- Runtime commit: `09f28b0b0a4482e896786e66fd564f2609d1868e` on `feat/order-confirmation-signature`.
- Previous authoritative deployment: `dpl_EMsgn1KYhNdpFPq3zLnUy56R4yHw`.
- New deployment: `dpl_9xwuUyapjT1TohjxegLrE6f8sqPe`, promoted `2026-10-11T16:10:49.967Z`.
- Two UI files changed: OrderSignaturePanel removes the billing prerequisite/editor; OrderConfirmationPDF removes its unused customer-refresh integration. Other 196 production source files preserved exactly; all 198 uploaded hashes verified.
- Applied only `202610110004_order_confirmation_prepare_without_billing.sql`, SHA-256 `45487c28b08c31ad303c7cb658d671b7c271cdb9a6feffbbe9efca100659835a`. It replaces only the signature action RPC, removing readiness calls from preparation/history. The unused private helper remains private. Authorization, locks, immutable snapshots, signing/replay branches and grants remain unchanged.
- Canonical customers, billing snapshots, public name/signature/acceptance form, private PDF storage and image-based signature rendering are unchanged. No signer ID or billing ID is required by the public signing workflow.

## Evidence

- 100 relevant tests across 14 files passed, including mouse/touch signature, rendered PDF ink, signing protections and email/WhatsApp regression boundaries. Build passed. Independent specification and security/code reviews passed.
- Disposable canonical migrations and signature/customer/HAKAFA/delivery suites passed. New fixtures prepare successfully for unlinked, complete-linked, incomplete-billing, archived-customer and unknown-VAT orders. Frozen data equals existing data; customer/order rows are not silently populated or updated. Migration 004 preserves all pre-existing revision rows exactly.
- Fresh isolated Linux/serverless PDF rehearsal passed: 27 unsigned/28 signed pages, visible image-based signature (3,755 changed dark raster channels for different strokes), Hebrew/RTL, name/time, no new signer-ID field, historical-ID compatibility, links, exact embedded original and hash guards. No provider access.
- Staged source/API checks passed before migration/promotion. Production invalid-link/unauthenticated/private-table/RPC boundaries, no-store/no-referrer and client secret scan passed. Authorized staff history works; instructor access denied.
- Live admin UI on ORD-1044: preparation enabled, billing prerequisite message absent, revision 1 signed, revision 2 pending, existing signed download available. No prepare/sign/send/revoke action clicked.
- All existing revisions and private artifact metadata unchanged; 35 business-table fingerprints, unrelated DB functions and Edge Functions unchanged. No QA order/customer/revision created or edited; no email/WhatsApp sent.
- Vercel Git deployment policy remains blocked and unchanged. No secret, Meta, payment/accounting/provider or club change. No push/merge to canonical main.

## Remaining manual gate

Open ORD-1044, prepare a new confirmation, copy its link, review it on a physical phone, enter signer name, draw/accept/submit, refresh admin history, and download that new revision's signed PDF. Verify visible drawn ink in Windows Edge and untouched separate safety/minor signature lines. No customer billing completion is needed.

**Production signature verification remains pending the user's manual result.** The previous deployment remains available for emergency application rollback; retain migration 004 and all existing evidence/artifacts rather than reintroducing a billing gate or rewriting history.
