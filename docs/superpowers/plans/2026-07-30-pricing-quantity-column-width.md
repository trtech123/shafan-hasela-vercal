# Pricing Quantity Column Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Pricing table's native Quantity input a 9rem minimum width inside a coordinated 10rem Quantity column so spinner controls and multi-digit values remain fully visible.

**Architecture:** Coordinate one width contract across the Quantity header, body cell, and input. Preserve the native number input and existing horizontal overflow container so the wider column stays aligned and cannot break narrow-screen page layout.

**Tech Stack:** React 18, Tailwind CSS, Vitest

---

### Task 1: Update the layout contract test

**Files:**

- Modify: `app/src/components/pricing/PricingQuantityColumn.test.jsx`

- [ ] **Step 1: Assert the expanded coordinated width contract**

Assert the rendered header and body cell use the approved 10rem contract:

```jsx
expect(quantityHeader).toHaveClass("w-40", "min-w-[10rem]");
expect(quantityCell).toHaveClass("w-40", "min-w-[10rem]", "px-2");
```

Assert the native number input keeps its numeric semantics and uses the approved 9rem minimum:

```jsx
expect(quantityInput).toHaveClass("w-full", "min-w-[9rem]", "px-2", "tabular-nums");
expect(quantityInput).toHaveAttribute("dir", "ltr");
expect(quantityInput).toHaveAttribute("type", "number");
expect(quantityInput).toHaveAttribute("min", "0");
```

Keep the single-digit and multi-digit value assertions, plus the existing `overflow-x-auto` assertion.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/pricing/PricingQuantityColumn.test.jsx --reporter=dot
```

Expected: fail because the current header and cell use `w-32 min-w-[8rem]` and the input uses `min-w-[7rem]`.

### Task 2: Apply the UI-only width adjustment

**Files:**

- Modify: `app/src/components/pricing/PricingCategory.jsx`
- Modify: `app/src/components/pricing/PricingRow.jsx`

- [ ] **Step 1: Widen the Quantity header**

Use:

```jsx
<th className="text-center px-3 py-2 font-medium w-40 min-w-[10rem]">כמות</th>
```

- [ ] **Step 2: Widen the matching body cell and input**

Use:

```jsx
<td className="px-2 py-2 w-40 min-w-[10rem]">
```

and:

```jsx
className="h-9 w-full min-w-[9rem] px-2 text-sm text-center tabular-nums"
dir="ltr"
```

Keep `type`, `value`, `onChange`, and `min` unchanged.

- [ ] **Step 3: Verify GREEN**

Run:

```powershell
npm test -- src/components/pricing/PricingQuantityColumn.test.jsx --reporter=dot
```

Expected: pass.

### Task 3: Verify compatibility and scope

**Files:**

- Verify: `app/src/components/pricing/PricingCategory.jsx`
- Verify: `app/src/components/pricing/PricingRow.jsx`
- Verify: `app/src/components/pricing/PricingQuantityColumn.test.jsx`

- [ ] **Step 1: Run all tests**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run focused lint**

```powershell
npx eslint src/components/pricing/PricingCategory.jsx src/components/pricing/PricingRow.jsx src/components/pricing/PricingQuantityColumn.test.jsx --quiet
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Vite exits successfully, proving Tailwind recognizes the new utilities.

- [ ] **Step 4: Inspect scope**

Run `git diff --check`, `git status --short`, and `git diff --stat`. Confirm production changes are limited to the two Pricing components and focused test, while quantity behavior lines remain unchanged.

### Task 4: Commit, push, and verify deployment

**Files:**

- Commit only: `app/src/components/pricing/PricingCategory.jsx`
- Commit only: `app/src/components/pricing/PricingRow.jsx`
- Commit only: `app/src/components/pricing/PricingQuantityColumn.test.jsx`

- [ ] **Step 1: Commit the verified UI change**

```powershell
git add -- app/src/components/pricing/PricingCategory.jsx app/src/components/pricing/PricingRow.jsx app/src/components/pricing/PricingQuantityColumn.test.jsx
git diff --cached --check
git commit -m "fix: expand pricing quantity column"
```

Expected: one implementation commit containing only the two components and focused test.

- [ ] **Step 2: Push the tracked branch**

```powershell
git push
```

Expected: `main` is pushed to `origin/main` successfully.

- [ ] **Step 3: Verify repository synchronization**

```powershell
git fetch origin
$localCommit = git rev-parse HEAD
$remoteCommit = git rev-parse '@{u}'
if ($localCommit -ne $remoteCommit) { throw "Local and tracked remote commits differ." }
git status --porcelain
```

Expected: the two commit hashes match and `git status --porcelain` prints no files.

- [ ] **Step 4: Verify the Vercel deployment for the pushed commit**

Query the authenticated GitHub deployment and commit-status APIs for `$localCommit`. Poll until the Vercel deployment reports a completed successful state, then request its deployment URL.

Expected: the Vercel deployment associated with the pushed commit reaches success and its URL responds successfully.
