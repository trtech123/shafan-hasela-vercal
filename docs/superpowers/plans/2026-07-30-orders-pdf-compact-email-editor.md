# Orders PDF Compact Email Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible Orders PDF recipient input with a compact recipient row and explicit pencil/`סיום` editing flow while preserving validation and sending.

**Architecture:** Add one local `isEditingEmail` state to `OrderConfirmationPDF`. Derive the initial editor/error state from `getEmailError`, route both `סיום` and Send through the existing validator, and retain `recipientEmail` as non-persistent modal state.

**Tech Stack:** React 18, Vitest, Testing Library, Tailwind CSS

---

### Task 1: Specify the compact and edit states with failing tests

**Files:**

- Modify: `app/src/components/orders/OrderConfirmationPDF.test.jsx`

- [ ] **Step 1: Replace the always-visible input expectation**

For a valid order address, assert:

```jsx
expect(screen.getByText("original@example.com")).toBeInTheDocument();
expect(screen.queryByLabelText("כתובת אימייל לשליחה")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "עריכת כתובת אימייל" })).toBeInTheDocument();
```

- [ ] **Step 2: Test pencil and valid Done behavior**

Click `עריכת כתובת אימייל`, edit the input to `  new@example.com  `, click `סיום`, then assert the input is absent and `new@example.com` is visible.

- [ ] **Step 3: Test invalid Done behavior**

Open edit mode, set an empty or malformed value, click `סיום`, and assert the input remains visible with the exact alert text.

- [ ] **Step 4: Test automatic invalid edit mode**

Render empty and malformed initial addresses. Assert the input and matching alert are visible immediately.

- [ ] **Step 5: Retain the Send boundary test**

For an address changed to an invalid value, click Send and assert edit mode opens, the inline error is visible, and the Supabase invocation mock was not called. Retain the valid edited-recipient send assertion.

- [ ] **Step 6: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/components/orders/OrderConfirmationPDF.test.jsx
```

Expected: failures because the current modal always renders the input and has no pencil, `סיום`, or edit-mode state.

### Task 2: Implement the minimal compact editor

**Files:**

- Modify: `app/src/components/orders/OrderConfirmationPDF.jsx`

- [ ] **Step 1: Add edit-mode state**

Initialize:

```jsx
const initialEmailError = getEmailError(order?.client_email || "");
const [isEditingEmail, setIsEditingEmail] = useState(Boolean(initialEmailError));
```

When the order changes, reset recipient state, derive the matching error, and set edit mode from that error.

- [ ] **Step 2: Add the Done handler**

Implement:

```jsx
const handleRecipientDone = () => {
  const normalized = recipientEmail.trim();
  const validationError = getEmailError(normalized);
  setEmailError(validationError);
  if (validationError) return;
  setRecipientEmail(normalized);
  setIsEditingEmail(false);
};
```

- [ ] **Step 3: Force invalid Send into edit mode**

In `handleEmail`, set `isEditingEmail` to true before returning on validation failure. On valid Send, normalize the local value and collapse edit mode before continuing the existing send flow.

- [ ] **Step 4: Render compact or editor mode**

Render plain recipient text plus a small pencil icon button in compact mode. Render the existing labeled input, inline alert, and `סיום` button in edit mode.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- src/components/orders/OrderConfirmationPDF.test.jsx
```

Expected: all compact-editor and email-send tests pass.

### Task 3: Verify scope and production compatibility

**Files:**

- Verify: `app/src/components/orders/OrderConfirmationPDF.jsx`
- Verify: `app/src/components/orders/OrderConfirmationPDF.test.jsx`

- [ ] **Step 1: Run the full tests**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run focused lint**

```powershell
npx eslint src/components/orders/OrderConfirmationPDF.jsx src/components/orders/OrderConfirmationPDF.test.jsx --quiet
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Vite exits successfully.

- [ ] **Step 4: Inspect scope**

Run `git diff --check`, `git status --short`, and `git diff --stat`. Confirm production changes are limited to `OrderConfirmationPDF.jsx`.
