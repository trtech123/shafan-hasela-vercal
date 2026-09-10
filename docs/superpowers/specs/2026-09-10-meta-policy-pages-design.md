# Meta Policy Pages Design

## Goal

Publish two customer-facing Hebrew pages required for the Shafan Hasela Meta application: `/privacy-policy` and `/data-deletion`.

## Routing

Both routes are top-level routes beside `/login`, outside `AuthenticatedApp`. They render without loading or checking authentication. The existing Vercel catch-all rewrite to `/index.html` provides direct-navigation and refresh support.

## Presentation

A shared `PublicPolicyLayout` provides the local Shafan Hasela logo, RTL document shell, forest-green and warm-orange brand palette, page navigation, business contact block, and responsive typography. Each policy page owns only its title, summary, effective date, and section content.

## Content contract

The privacy policy describes customer/contact, conversation, and order-related information; service, booking, and human-handoff purposes; Meta/WhatsApp as a communications provider; external payment providers; access controls; purpose-based retention; and access/correction/deletion requests.

The deletion page asks only for a name, WhatsApp phone number, and relevant conversation or order context. It explains identity/context verification, review-based handling, and possible retention of operational, accounting, or legally required records. It never asks for card information or promises automatic deletion.

The published contact for both pages is `Info.shafan@gmail.com`.

## Scope boundaries

No chatbot behavior, Supabase schema or functions, payment code, Meta settings, or authenticated application routes change.

## Verification

Tests render the public routing boundary at each direct URL without an authenticated session, assert that no login redirect occurs, and verify required Hebrew disclosures and contact details. Verification also includes the full test suite, production build, focused lint, touched-file TypeScript checks, `git diff --check`, and live production URL checks after deployment.
