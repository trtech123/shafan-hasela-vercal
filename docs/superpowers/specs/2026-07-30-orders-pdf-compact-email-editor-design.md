# Orders PDF Compact Email Editor Design

## Scope

Change only `app/src/components/orders/OrderConfirmationPDF.jsx` and its focused test. Keep PDF generation, email sending, WhatsApp actions, download behavior, document content, and every other screen unchanged.

## Interaction

- A valid `order.client_email` opens in a compact recipient row showing the address as plain text and a small pencil button.
- Clicking the pencil opens the existing editable email input.
- Edit mode includes a `סיום` button.
- Clicking `סיום` validates the trimmed value:
  - Valid: store the trimmed value in local modal state, clear any error, and return to compact mode.
  - Empty: remain in edit mode and show `יש להזין כתובת אימייל`.
  - Invalid: remain in edit mode and show `כתובת האימייל אינה תקינה`.
- An empty or invalid initial order email opens directly in edit mode with the matching inline error.
- Clicking `שלח במייל` always validates:
  - Valid: normalize the address, collapse to compact mode, and continue the existing PDF/email flow.
  - Empty or invalid: open edit mode, show the matching inline error, and stop before PDF generation or the Supabase function call.
- Editing a value clears the visible error as soon as the current value becomes valid, but the editor remains open until `סיום` or a valid Send action.
- Recipient edits remain local to the modal and do not persist to the order.

## Accessibility and styling

- The pencil control has the accessible label `עריכת כתובת אימייל`.
- The `סיום` control is a normal button beside the input.
- The compact row uses the existing white card, slate text, spacing, and border language.
- Inline errors retain `role="alert"` and the existing red treatment.

## Acceptance criteria

1. A valid address is plain text by default; the input is absent.
2. Pencil click reveals the prefilled input and `סיום`.
3. Valid `סיום` trims and returns to compact mode.
4. Empty or invalid `סיום` keeps edit mode open with the exact inline error and does not change the compact value.
5. Empty or invalid initial values show edit mode and the exact inline error.
6. Invalid Send opens edit mode, shows the error, and does not invoke `send-order-doc`.
7. A valid edited address remains the recipient used by `send-order-doc`.
8. No other modal behavior or screen changes.
