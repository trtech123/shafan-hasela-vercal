# Pricing Quantity Column Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Pricing table's native Quantity input enough stable horizontal room for spinner controls and multi-digit values.

**Architecture:** Coordinate one width contract across the Quantity header, body cell, and input. Preserve the existing horizontal overflow container so the wider column cannot break narrow-screen page layout.

**Tech Stack:** React 18, Tailwind CSS, Vitest

---

### Task 1: Add a failing layout contract test

**Files:**

- Create: `app/src/components/pricing/PricingQuantityColumn.test.jsx`

- [ ] **Step 1: Read both Pricing component sources**

Use `readFileSync` to load `PricingCategory.jsx` and `PricingRow.jsx`.

- [ ] **Step 2: Assert the coordinated width contract**

Assert the header contains:

```jsx
className="text-center px-3 py-2 font-medium w-32 min-w-[8rem]"
```

Assert the body cell contains:

```jsx
className="px-2 py-2 w-32 min-w-[8rem]"
```

Assert the number input retains `type="number"`, `min={0}`, and the unchanged quantity change handler while adding:

```jsx
className="h-9 w-full min-w-[7rem] px-2 text-sm text-center tabular-nums"
dir="ltr"
```

Assert `PricingCategory.jsx` still contains `className="overflow-x-auto"`.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npm test -- src/components/pricing/PricingQuantityColumn.test.jsx
```

Expected: fail because the current column uses `w-24` and the input lacks the new minimum width.

### Task 2: Apply the UI-only width adjustment

**Files:**

- Modify: `app/src/components/pricing/PricingCategory.jsx`
- Modify: `app/src/components/pricing/PricingRow.jsx`

- [ ] **Step 1: Widen the header**

Replace only the Quantity header width with:

```jsx
<th className="text-center px-3 py-2 font-medium w-32 min-w-[8rem]">כמות</th>
```

- [ ] **Step 2: Widen the body cell and input**

Use:

```jsx
<td className="px-2 py-2 w-32 min-w-[8rem]">
```

and:

```jsx
className="h-9 w-full min-w-[7rem] px-2 text-sm text-center tabular-nums"
dir="ltr"
```

Keep `type`, `value`, `onChange`, and `min` unchanged.

- [ ] **Step 3: Verify GREEN**

Run:

```powershell
npm test -- src/components/pricing/PricingQuantityColumn.test.jsx
```

Expected: pass.

### Task 3: Verify compatibility and scope

**Files:**

- Verify the two Pricing components and layout test.

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

Run `git diff --check`, `git status --short`, and `git diff --stat`. Confirm production changes are limited to the two Pricing components and quantity behavior lines are unchanged.
