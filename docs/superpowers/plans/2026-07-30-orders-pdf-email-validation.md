# Orders PDF Email Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate an editable recipient address in the Orders PDF email modal and add vertical separation to only the standard order-form pricing row.

**Architecture:** Keep recipient edits as local `OrderConfirmationPDF` state initialized from `order.client_email`; validate at the send boundary and pass the normalized local value to the existing Edge Function. Make the layout change with one Tailwind margin utility on the standard pricing grid only.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Tailwind CSS, Supabase Functions

---

### Task 1: Add the focused test harness and failing Orders tests

**Files:**

- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/components/orders/OrderConfirmationPDF.test.jsx`
- Create: `app/src/components/orders/OrderFormDialog.spacing.test.js`

- [ ] **Step 1: Install focused test dependencies**

Run:

```powershell
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

Add this script to `app/package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write failing email modal tests**

Render `OrderConfirmationPDF` with mocked PDF generation and Supabase invocation. Assert:

```jsx
expect(screen.getByLabelText("כתובת אימייל לשליחה")).toHaveValue(order.client_email);
```

Clicking send with an empty value must expose:

```jsx
expect(await screen.findByRole("alert")).toHaveTextContent("יש להזין כתובת אימייל");
expect(invokeMock).not.toHaveBeenCalled();
```

Clicking send with a malformed value must expose:

```jsx
expect(await screen.findByRole("alert")).toHaveTextContent("כתובת האימייל אינה תקינה");
expect(invokeMock).not.toHaveBeenCalled();
```

After editing to `new@example.com`, sending must call:

```jsx
expect(invokeMock).toHaveBeenCalledWith(
  "send-order-doc",
  expect.objectContaining({
    body: expect.objectContaining({ to: "new@example.com" }),
  })
);
```

- [ ] **Step 3: Write the failing layout test**

Read `OrderFormDialog.jsx` and assert that the standard pricing grid includes `my-2`, while the task-mode grid retains its existing class:

```js
expect(source).toContain(
  '<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-2">'
);
expect(source).toContain(
  '<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">'
);
```

- [ ] **Step 4: Run tests and verify the expected failures**

Run:

```powershell
npm test -- --run app/src/components/orders/OrderConfirmationPDF.test.jsx app/src/components/orders/OrderFormDialog.spacing.test.js
```

Expected: failures because the recipient input and standard-grid `my-2` class do not exist.

### Task 2: Implement recipient validation and local editing

**Files:**

- Modify: `app/src/components/orders/OrderConfirmationPDF.jsx`

- [ ] **Step 1: Add local recipient and inline error state**

Import `useEffect`, `Input`, and `Label`. Initialize and synchronize:

```jsx
const [recipientEmail, setRecipientEmail] = useState(order?.client_email || "");
const [emailError, setEmailError] = useState("");

useEffect(() => {
  setRecipientEmail(order?.client_email || "");
  setEmailError("");
  setEmailSent(false);
}, [order?.id, order?.client_email]);
```

- [ ] **Step 2: Add exact validation messages**

Use:

```jsx
const getEmailError = (value) => {
  const normalized = (value || "").trim();
  if (!normalized) return "יש להזין כתובת אימייל";
  if (!isValidEmail(normalized)) return "כתובת האימייל אינה תקינה";
  return "";
};
```

At the start of `handleEmail`, set the returned error and stop before PDF generation when it is non-empty. Use `recipientEmail.trim()` as `body.to` on valid sends.

- [ ] **Step 3: Render the editable field and inline alert**

Add a toolbar-adjacent field that is not part of the captured PDF:

```jsx
<Label htmlFor="order-pdf-recipient-email">כתובת אימייל לשליחה</Label>
<Input
  id="order-pdf-recipient-email"
  type="email"
  value={recipientEmail}
  onChange={handleRecipientChange}
  aria-invalid={Boolean(emailError)}
  aria-describedby={emailError ? "order-pdf-recipient-email-error" : undefined}
  dir="ltr"
/>
{emailError && (
  <p id="order-pdf-recipient-email-error" role="alert">
    {emailError}
  </p>
)}
```

Keep the send button disabled only for `emailBusy`, and update its title to reference the trimmed local address.

- [ ] **Step 4: Run focused email tests**

Run:

```powershell
npm test -- --run app/src/components/orders/OrderConfirmationPDF.test.jsx
```

Expected: all email modal tests pass.

### Task 3: Add scoped pricing-row spacing

**Files:**

- Modify: `app/src/components/orders/OrderFormDialog.jsx`

- [ ] **Step 1: Add margin only to the standard pricing grid**

Change only:

```jsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
```

to:

```jsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-2">
```

Do not modify the task-mode `sm:grid-cols-2` branch.

- [ ] **Step 2: Run the layout test**

Run:

```powershell
npm test -- --run app/src/components/orders/OrderFormDialog.spacing.test.js
```

Expected: the layout test passes.

### Task 4: Verify the complete scoped change

**Files:**

- Verify all changed files

- [ ] **Step 1: Run the full test suite**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run lint and typecheck**

```powershell
npm run lint
npm run typecheck
```

Expected: both commands exit successfully.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Vite exits successfully and writes `dist`.

- [ ] **Step 4: Inspect the final diff**

Confirm that production changes are limited to:

- `OrderConfirmationPDF.jsx`
- The standard pricing-grid class in `OrderFormDialog.jsx`

Confirm task mode and all unrelated email/quantity inputs are unchanged.
