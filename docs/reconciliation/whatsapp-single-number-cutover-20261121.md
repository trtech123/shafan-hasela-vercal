# WhatsApp chatbot single-number cutover — preparation only

Target: Nurit's WhatsApp Business app number **+972 50-350-4478** becomes the only chatbot number. Existing Cloud API number **+972 58-503-0027** is a temporary fallback during acceptance, then is removed from bot routing. This document does not authorize Meta onboarding, Edge deployment, credential changes, or messaging.

## Verified baseline and current gaps

- The live Vercel alias resolved to READY deployment `dpl_7Cf8KjkJpXULrHpVtazjB4ZVCSqm` during this preparation. Source baseline is `78eb232475c3875e8cc56a89fd110554c7dfaca0` from the approved signature-guidance release.
- Read-only Meta UI inspection found app `Shafan hasela bot` (`1684280046173007`) using only API number +972 58-503-0027, phone-number ID `1191274184075486`, WABA `28097988189837294`. The target number is not yet a connected API number. No Embedded Signup configuration was visible. Tech Provider/Solution Partner eligibility and target number ownership are **not confirmed**.
- The webhook HMAC verification is retained. Its normalized events carry the signed payload's `metadata.phone_number_id`. Before this candidate, every bot reply used the single `META_PHONE_NUMBER_ID`, so a message received on a newly connected number could be answered from the old one.
- This candidate routes signed inbound messages by their explicit source phone-number ID. The active ID/token remain the default for staff replies and proactive sends. An optional fallback ID/token pair is accepted only during transition. Unknown or missing source IDs are ignored before persistence and sending. An explicitly configured fallback with a missing token fails on attempted sending before network I/O, allowing the webhook error path to request provider retry. No ID or token for Nurit's number is guessed or embedded in code.
- Customer-facing `wa.me/972503504478` and the document contact phone already show the desired digits. A phone-number ID is an opaque Meta asset ID, not the phone digits.

## Configuration map (no live changes made)

| Stage | `META_PHONE_NUMBER_ID`, `META_WHATSAPP_TOKEN`, `META_WABA_ID` | `META_FALLBACK_PHONE_NUMBER_ID`, `META_FALLBACK_WHATSAPP_TOKEN` | Bot behavior |
| --- | --- | --- | --- |
| Before onboarding | Existing old assets | Unset | Existing old line only |
| New-line acceptance | Existing old assets | New ID and new scoped token | New inbound is answered on new line; all proactive sends remain old |
| Cutover | New ID, new scoped token, new WABA ID | Old ID and old scoped token | Proactive sends and both inbound routes work; old is rollback fallback |
| Retirement | New assets | Unset | Only new line is processed; old API registration can remain as a dormant rollback asset temporarily |

The active triple is used by `whatsapp-webhook`, `chatbot-handoff-admin`, `send-whatsapp`, `send-quote-whatsapp`, `send-order-doc`, and `send-order-signature`; the quoted delivery code also includes a shared runtime copy. Audit each deployed Edge function before changing project-wide secrets. The new fallback pair is used only by the webhook candidate. Do not overwrite a token if it lacks access to the corresponding WABA. Keep all secret values in Supabase secrets, never Git or client bundles.

## Meta prerequisites and human actions

1. **Account eligibility:** in Meta Developers, verify that the portfolio/app is an approved Solution Partner or Tech Provider. Under **Facebook Login for Business → Configurations**, create a supported Embedded Signup configuration with session logging and the Business-app option; v5 enables that option by default, while v2/v3 are deprecated. The current dashboard has no visible configuration, and the application has no Embedded Signup launch/callback page. If the account cannot provide that configuration, a qualified partner or a separately reviewed onboarding implementation is required. Obtain any partner's exact access scope and fees before using it.
2. **Nurit's device:** confirm the target is in the WhatsApp Business app (version 2.24.17+), its owner/portfolio, ability to receive the official Meta verification message, any existing partner or credit-line relationship, current backup, linked devices, and use of broadcast/disappearing/view-once/live-location features. Nurit decides whether to share historical chats; never import them without that consent.
3. **Before onboarding:** deploy and verify the routing candidate only under separate approval, with the old active ID. Subscribe the app callback to `messages`, `account_update`, `history`, `smb_app_state_sync`, and `smb_message_echoes`; ensure the extra lifecycle events do not trigger bot replies. Prepare secure handling of app-originated echoes and the one-time contact/history synchronization before actual onboarding.
4. **Embedded Signup:** the owner launches the official supported flow with the Business-app option. Nurit enters her existing number, opens the official Facebook Business Account message inside WhatsApp Business, taps **Connect**, then **Connect to the Business Platform**, confirms the history-sharing choice, and enters the verification code. The current Meta guide describes a verification code, not a required QR scan. Do not use ordinary number registration or deregistration; Meta says to skip registration for an existing Business-app number. Capture the returned new `waba_id`, phone-number ID and exchangeable token code securely.
5. **Within 24 hours:** request one-time contact and history synchronization as Meta requires, handling a declined history-sharing response without storing private chat content. Confirm `is_on_biz_app=true` and `platform_type=CLOUD_API` on the **new phone-number ID**; verify webhook subscriptions, WABA permissions, token scope and template approval on the new WABA.

## Acceptance, cutover and rollback

1. With the old line active and the new line configured only as fallback, send one approved synthetic inbound message to Nurit's number. Verify signed webhook receipt, exactly one bot reply **from Nurit's number**, status callback and no reply to `smb_message_echoes`. Test a document-delivery template only with an approved recipient and after confirming it exists on the new WABA. Verify Nurit's Business app still receives and sends 1:1 messages.
2. Verify the old line still works, then switch the active triple to the new assets and keep the old fallback pair. Test inbound reply, authorized staff outbound, template and document delivery, handoff, and customer-facing links. Check message IDs and delivery statuses. Do not use real customers without approval.
3. After an agreed observation period, remove the old fallback pair from the webhook and stop advertising the old number. Keep old registration/token available but unused for a limited rollback period; retire it only after separate approval and an audit of queued or uncertain sends. The final chatbot operates on **one** number.
4. **Application rollback before retirement:** restore the old active triple, remove or isolate the new fallback, and restore the prior webhook deployment if needed. Do not automatically replay uncertain sends. After onboarding, this changes bot routing only; it does not disconnect Nurit's Business app from Cloud API.
5. **Meta offboarding, only if Nurit elects it:** she uses WhatsApp Business **Settings → Account → Business Platform → Disconnect Account**. Meta's `PARTNER_REMOVED` event confirms the action. Do not use the deregister API or delete her app account. App feature/device effects may not all reverse automatically.

## Release gates

- **Code candidate:** inbound-number routing is locally tested. Full Deno check of the Edge entry still requires npm registry access; the isolated JS modules pass Deno check. No Edge function has been deployed from this branch.
- **Meta eligibility:** NO-GO until Partner/Tech Provider status, Embedded Signup configuration, ownership and app-version checks are verified.
- **Coexistence behavior:** NO-GO until app-originated echoes, history/contact synchronization and human-versus-bot handoff behavior are designed and locally tested. The existing normalizer ignores non-`messages` fields; this is loop-safe but does not mirror Nurit's app messages into the app's conversation history as Meta describes.
- **Templates/document delivery:** NO-GO until required templates and provider permissions are verified on the new WABA and an approved test confirms delivery from the new number.

Meta references: [Business-app onboarding and limitations](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/), [app-originated echo webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes/), [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/).
