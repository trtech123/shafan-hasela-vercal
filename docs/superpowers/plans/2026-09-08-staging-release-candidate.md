# Shafan Hasela Staging Release Candidate Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and validate one non-production release-candidate branch containing the frozen unified integration, accepted QA fixes, and accepted chatbot runtime.

**Architecture:** Preserve the three source worktrees and integrate their immutable commit objects into a new branch rooted at the frozen base. Merge QA before chatbot, resolve shared navigation and progress documentation semantically, verify all subsystem contracts, then use only an explicitly non-production Supabase project and Vercel Preview deployment.

**Tech Stack:** Git worktrees, React 18, Vite, Vitest, ESLint, TypeScript checkJs, Supabase CLI/Postgres migrations and Edge Functions, Vercel Preview.

---

### Task 1: Integrate the accepted histories

**Files:**
- Modify by merge: `PROGRESS.md`
- Modify by merge: `app/src/App.jsx`
- Modify by merge: `app/src/components/Layout.jsx`
- Add by merge: `app/src/pages/ChatbotHandoffs.jsx`
- Add by merge: `supabase/migrations/026_chatbot_runtime.sql`
- Add by merge: `supabase/functions/whatsapp-webhook/**`
- Add by merge: `supabase/functions/chatbot-handoff-admin/**`

- [ ] **Step 1: Verify immutable inputs**

Run:

```powershell
git show -s --format='%H %P %s' 489b8c7fb101794bc2af33a3df2bea44a242d43a 1fb2d7c0b5b72826655b9b9ad892368795a77876 6b242727dde7500d3e928e6135ba8daf5d2ed3b5
```

Expected: all three objects are commits; QA descends from the base; chatbot history is available through the accepted tip.

- [ ] **Step 2: Merge accepted QA fixes**

Run:

```powershell
git merge --no-ff 1fb2d7c0b5b72826655b9b9ad892368795a77876 -m "merge: integrate accepted final QA fixes"
```

Expected: one merge commit containing the single WhatsApp order action and Clubs QA fixes.

- [ ] **Step 3: Merge accepted chatbot runtime**

Run:

```powershell
git merge --no-ff 6b242727dde7500d3e928e6135ba8daf5d2ed3b5 -m "merge: integrate accepted chatbot runtime"
```

Expected: conflicts only in genuinely shared files. Preserve the QA `חוגים` item, chatbot handoff item and route, both completion records, and migration number 026.

- [ ] **Step 4: Prove migration ordering and feature presence**

Run:

```powershell
Get-ChildItem supabase/migrations/02*.sql | Sort-Object Name | Select-Object -ExpandProperty Name
rg -n 'path="/clubs"|path="/chatbot-handoffs"|שלח אישור בוואטסאפ|order_confirmation_pdf' app/src
```

Expected: migrations 021 through 026 appear once in numeric order; required routes and canonical WhatsApp flow are present.

### Task 2: Verify and repair integration regressions

**Files:**
- Test: `app/src/**/*.test.{js,jsx}`
- Test: `supabase/functions/**/*.test.{js,ts}`
- Modify only if a regression is proven: the narrowest responsible integrated source file

- [ ] **Step 1: Install the accepted dependency graph**

Run:

```powershell
npm ci --ignore-scripts
```

Expected: dependencies install without changing tracked manifests.

- [ ] **Step 2: Run focused subsystem suites**

Run the quotation/WhatsApp, chatbot, Pelecard, Clubs/iCredit, Rivhit, and migration-contract Vitest files explicitly with one worker. Expected: every suite passes with zero skipped regression contracts.

- [ ] **Step 3: Run the full application suite**

Run:

```powershell
npm test -- --pool=threads --maxWorkers=1
```

Expected: all test files and tests pass.

- [ ] **Step 4: Run build and static gates**

Run `npm run build`, focused ESLint over integrated production/test files, project TypeScript with touched-file filtering, strict shared payment TypeScript checks, and `git diff --check`. Expected: build and focused checks pass; any repository baseline diagnostics are counted and separated from touched-file diagnostics.

- [ ] **Step 5: Fix only proven integration regressions**

For each failure, reproduce it with the narrowest existing test, add a failing regression test only when coverage is missing, implement the smallest fix, rerun the focused suite, then rerun the full relevant gate.

### Task 3: Validate an approved staging Supabase project

**Files:**
- Read: `supabase/config.toml`
- Read: local ignored Supabase linkage/configuration
- Apply remotely only when the target project is explicitly non-production: `supabase/migrations/021_pelecard_payment_ledger.sql` through `026_chatbot_runtime.sql`

- [ ] **Step 1: Discover the linked project without printing secrets**

Use Supabase CLI project/link metadata and environment-variable names only. Treat project ref `divzxsynczeifkpnpupl` as Production and refuse all migrations/functions against it. Expected: either a distinct approved staging project is identified or staging infrastructure is recorded as the sole database blocker.

- [ ] **Step 2: Audit migration state before mutation**

Run linked migration-list and dry-run commands against the staging ref. Expected: migrations before 021 are already applied and pending changes are exactly 021, 022, 023, 024, 025, and 026 in order.

- [ ] **Step 3: Apply and validate migrations**

Apply the pending migrations to staging only. Validate tables, RLS flags/policies, role protection, required RPCs, uniqueness/idempotency constraints, and safe replay/concurrency contracts using read-only catalog queries and disposable test records only where the existing test scripts explicitly provide rollback-safe behavior.

- [ ] **Step 4: Deploy staging-only Edge Functions**

Deploy only integrated functions required by the accepted work to the staging project. Keep outbound functions JWT-protected; keep `whatsapp-webhook` public only at the transport boundary with Meta verification/signature checks in application code. Do not invoke providers or send messages.

### Task 4: Commit and deploy the release candidate

**Files:**
- Modify: `PROGRESS.md`
- Preserve: all source worktrees

- [ ] **Step 1: Record consolidated non-production results**

Update `PROGRESS.md` with integrated commits, conflicts, verification totals, staging result or blocker, function deployment result, and explicit Production exclusions.

- [ ] **Step 2: Commit the final release candidate**

Run `git diff --check`, review the staged diff, and commit with a release-candidate integration message. Expected: clean branch with both accepted commits reachable from `HEAD`.

- [ ] **Step 3: Deploy Vercel Preview only**

Deploy a clean archive of the final commit to existing project `trtechs-projects/shafan-hasela-vercal`, whose Root Directory is `app`, using `--target preview` and never `--prod`. Attach the exact commit SHA as deployment metadata.

### Task 5: Runtime verification and preservation proof

**Files:**
- No product changes unless a runtime regression is reproduced

- [ ] **Step 1: Verify Preview routes and roles**

Using intercepted non-production data or the approved staging backend, verify admin Clubs navigation/direct route, non-admin denial, the Clubs data state, quotation/product behavior, chatbot handoff route/UI, and the single order WhatsApp action. Do not click provider-send or payment actions.

- [ ] **Step 2: Verify final deployment metadata**

Inspect Vercel and confirm project, Preview target, Ready status, URL, and final release-candidate SHA. Confirm the Production alias still resolves to its pre-existing deployment.

- [ ] **Step 3: Verify worktree preservation**

Run `git worktree list --porcelain`, compare source worktree HEADs to the approved SHAs, report their pre-existing dirt exactly, and confirm the release-candidate worktree is clean.
