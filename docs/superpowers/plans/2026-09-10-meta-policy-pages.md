# Meta Policy Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and deploy public Hebrew privacy and data-deletion pages for the Shafan Hasela Meta application.

**Architecture:** Register two top-level routes outside the authenticated application shell. Render both through one shared branded layout, with page-specific semantic content and one verified business contact address.

**Tech Stack:** React 18, React Router 6, Tailwind CSS, Vitest, Testing Library, Vite, Vercel.

---

### Task 1: Public routing contract

**Files:**
- Create: `app/src/pages/PublicPolicies.test.jsx`
- Modify: `app/src/App.jsx`

- [ ] Write failing route tests that open `/privacy-policy` and `/data-deletion` without an authenticated user, require their page headings, and reject a `/login` redirect.
- [ ] Run `npm test --prefix app -- src/pages/PublicPolicies.test.jsx` and verify RED because the routes do not exist.
- [ ] Export a router-friendly application route boundary and register both policy routes before the authenticated wildcard route.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Shared branded policy pages

**Files:**
- Create: `app/src/components/public/PublicPolicyLayout.jsx`
- Create: `app/src/pages/PrivacyPolicy.jsx`
- Create: `app/src/pages/DataDeletion.jsx`
- Test: `app/src/pages/PublicPolicies.test.jsx`

- [ ] Extend the tests with required disclosure, minimum-identification, email-link, local-logo, and forbidden-card-request assertions; verify RED.
- [ ] Implement an RTL, mobile-responsive shared layout using `/shafan-logo.jpg`, existing brand colors, semantic headings, internal policy navigation, and `mailto:Info.shafan@gmail.com`.
- [ ] Implement clear Hebrew privacy content covering the approved information, purposes, providers, security, retention, and user-rights statements without unsupported promises.
- [ ] Implement the Hebrew deletion instructions, limited identification requirements, verification/review explanation, and careful retention exception.
- [ ] Re-run focused tests and verify GREEN.

### Task 3: Verification and commit

**Files:**
- Verify all touched frontend and documentation files.

- [ ] Run `npm test --prefix app -- src/pages/PublicPolicies.test.jsx`.
- [ ] Run `npm test --prefix app` with the existing public Supabase Vite variables supplied only to the process.
- [ ] Run `npm run build --prefix app`, focused ESLint on touched JSX files, touched-file `tsc --allowJs --checkJs --jsx react-jsx --noEmit`, and `git diff --check`.
- [ ] Commit the implementation and verification-ready documentation with `git commit -m "feat: add public Meta policy pages"`.

### Task 4: Production deployment and live checks

**Files:**
- No source changes expected.

- [ ] Deploy the `app/` project to the existing Vercel Production project.
- [ ] Confirm `/privacy-policy` and `/data-deletion` each return HTTP 200 on direct requests and contain their expected heading/contact marker.
- [ ] Confirm the deployed authenticated root behavior remains separate and report the commit SHA, deployment URL, exact policy URLs, and verification results.
