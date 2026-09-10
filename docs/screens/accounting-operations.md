# Accounting Operations — Action Map

## Visible actions

- Refresh accounting state.
- Retry an eligible accounting event through the protected backend worker.
- Open an existing Rivhit document link in a new tab.

## Data loaded

- Protected `payment_accounting_operations` view: accounting event, local payment, order/sale identity, Rivhit document, attempts, error, and retry timing.

## Data written

- The browser writes nothing directly.
- Retry calls `payment-accounting-worker`; service-role RPCs alone claim/finalize the event.

## Cross-screen behavior

- Pelecard payment, sale, and order success remain unchanged for every accounting state.
- Rivhit results written by the existing accounting workflow appear here after refresh.

## Acceptance criteria

- Admin and operations see the page; other roles are redirected.
- Every row shows payment/order identity, amount, success time, accounting/document status, attempts, last error and next retry.
- A document number/link appears only when persisted.
- Retry is offered only for backend-eligible states and cannot mutate payment success.
- Reconciliation-required and configuration-required states are explicit in Hebrew.

