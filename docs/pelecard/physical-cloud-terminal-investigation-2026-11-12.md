# Physical cloud terminal investigation — 2026-11-12

## Merchant facts supplied by Pelecard support

- Physical merchant terminal: `2814926`.
- Register `003`: N86. Registers `004`, `005`, `006`: CT20.
- The Pelecard app on each device sets its register number. These are merchant facts, not a published API contract.

## Official documentation reviewed

| Source | What it establishes | Limit |
| --- | --- | --- |
| [Pelecard API page](https://pelecard.com/api/) and [gateway developer page](https://gateway21.pelecard.biz/) | Pelecard has a gateway Services API. | No cloud device command, device routing, or result contract is stated. |
| [Gateway Services sandbox](https://gateway21.pelecard.biz/SandboxServices) | A gateway request builder with terminal/user/password fields. | It does not document a server-to-device payment operation. |
| [Pelecard PoS Bridge](https://docs.pelecard.com/documentation/pos-bridge/) | Local HTTP `POST http://127.0.0.1:8019/PosBridge/CreateSession`, then `PaymentFull` or `PaymentStart`/`PaymentEnd`, with amounts in agorot. | It requires a Windows service and locally connected PIN pad. `KupaNo` is explicitly marked unsupported in its two-stage request; this cannot be substituted for the requested cloud flow. |
| [Android SDK guide](https://docs.pelecard.com/documentation/android-sdk-developer-guide/) | On-device N86 SDK initialization and payment methods, including a ten-digit transaction ID. | It requires an app on the device; it is not a remote cloud API. The page does not establish CT20 support. |
| [Payper invoice API](https://docs.pelecard.com/documentation/create-payper-invoice-api/) | `POST https://gateway21.pelecard.biz/services/CreatePayperInvoice`, JSON body with `terminalNumber`, `user`, `password`, `trxRecordId`, `Uid`, and `PayperParameters.typeDocument: "invoice-receipt"`. Amounts are in agorot. | Pelecard says Payper activation is required. It does not confirm that merchant terminal `2814926` is activated or that the physical transaction yields the necessary `trxRecordId` and `Uid`. |

The `/services` card charge examples collect a card number or token. They do not command the customer's physical N86/CT20 device. The hosted `PaymentGW` path is likewise unrelated to card-present dispatch.

## Missing provider contract — activation blocker

Pelecard must supply in writing:

1. The exact HTTPS endpoint, HTTP method, authenticated JSON request and response for cloud card-present charge to `2814926` and register `003`–`006`, including amount units, merchant reference/idempotency field, and whether an additional merchant capability must be enabled. Confirm how the API acknowledges that the assigned device received the request and displays the validated amount.
2. Dedicated physical API credentials and their scope. Existing digital credentials are not reused or assumed valid.
3. The authoritative lookup endpoint and correlation keys after a browser closure, timeout, or terminal disconnection; approved, declined, cancelled, in-progress, and unknown response codes; and whether a callback/webhook exists with signature verification.
4. The safe cancellation command and its race semantics. A local browser cancel must not be treated as proof that a charge failed.
5. The physical payment's Pelecard transaction ID, `trxRecordId`, and `Uid` mapping; Payper API authorization for terminal `2814926`; and whether the existing Payper account may issue for that terminal with separate credentials.

No production call, migration, or feature activation is authorized by this investigation. The runtime must fail closed until the contract is implemented and mocked tests cover its exact response schema.

## Planned isolation and guarantees

The new method uses a separate physical intent, provider adapter, credentials, workstation-to-register mapping and disabled-by-default flag. A server-only mapping selects the register; the client cannot override it. Catalog prices are recalculated on the server and frozen before a dispatch attempt. The selected terminal must display that exact amount before the customer presents a card; dispatch acknowledgement alone is not payment approval. A durable unique request key and an atomic register lock allow one dispatch per intent and one in-flight intent per device. Any send timeout or ambiguous response remains unresolved until an authenticated provider lookup proves a final result. A verified approval must match merchant terminal, register, amount, intent reference and provider transaction ID before an atomic database finalizer creates one sale and makes one Payper document eligible. Existing Payper one-shot ledger rules must be used via a separate physical adapter; the continuous digital worker and credentials remain unchanged. Duplicate document checks must include the provider transaction identity and all existing sale/order document sources.

The current branch contains a mocked, provider-neutral workflow and a closed physical configuration gate. It does **not** yet have the provider adapter, database finalizer, Payper physical adapter or a live POS action. Those require the missing contract and further implementation. No live payment or invoice has been attempted.
