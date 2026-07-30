# Orders PDF Email Validation and Pricing Spacing Design

## Scope

Change only the customer-facing order confirmation PDF modal and the standard order-form pricing row.

Files in scope:

- `app/src/components/orders/OrderConfirmationPDF.jsx`
- `app/src/components/orders/OrderFormDialog.jsx`
- Focused tests and test configuration needed to verify these changes

The login screen, order customer-details email field, accounting email field, instructor email dialogs, task mode, Pricing page, and every other email or quantity input are out of scope.

## Orders PDF email modal

Add an editable recipient email input to `OrderConfirmationPDF`. Its initial value comes from `order.client_email`, but edits remain local to the modal and do not update the order.

When the user clicks the email-send button:

1. Trim the recipient value.
2. If it is empty, show the inline message `יש להזין כתובת אימייל` and stop.
3. If it does not match the existing email format rule, show the inline message `כתובת האימייל אינה תקינה` and stop.
4. If it is valid, clear the inline error, generate the PDF, and invoke `send-order-doc` using the edited, trimmed recipient value.

The inline error appears directly beneath the recipient input and is exposed as an alert for accessibility. While an error is visible, editing the value revalidates it so the message clears as soon as the address becomes valid. Editing also resets the sent-state label.

The send button remains clickable when the value is empty or invalid so a click can surface the inline validation message. It remains disabled only while an email send is already in progress.

## Standard order-form pricing spacing

Add a small vertical margin (`my-2`) to the existing three-column standard pricing grid containing:

- Number of participants
- Price per participant
- Total payment

This separates the pricing row from the date/time fields above and status/payment fields below while preserving the existing spacing scale. The task-mode two-column pricing grid is unchanged.

## Orders screen action map

- Visible action changed: `שלח במייל` in the order confirmation PDF overlay.
- Form field added: local recipient email, prefilled from `order.client_email`.
- Data loaded: existing order and activity props only.
- Data written: no database write; a valid recipient is passed to the existing `send-order-doc` Edge Function.
- Cross-screen sync: none; editing the recipient does not persist to the order.
- Acceptance criteria:
  - Empty recipient shows `יש להזין כתובת אימייל` inline and does not send.
  - Invalid recipient shows `כתובת האימייל אינה תקינה` inline and does not send.
  - A valid edited recipient is used for the send request.
  - The standard order pricing grid has additional vertical separation.
  - Task mode and all other email and quantity inputs remain unchanged.

## Testing

Add focused component tests for empty, invalid, and edited-valid recipient values. Mock PDF rasterization and the Supabase function boundary so the valid test verifies the actual recipient passed to `send-order-doc`.

Add a focused source-level layout assertion for the Tailwind margin class because the requested spacing is a static class change. The assertion also protects the task-mode grid from receiving that class.

Run the focused tests, lint, typecheck, and production build.
