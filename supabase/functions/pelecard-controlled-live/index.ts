import {paymentJson} from './_deployed_shared/payment-http.ts';
// Retired one-shot operator API. Existing provider callback URL is retained
// separately; normal staff operations use the authorized order-payment API.
Deno.serve(()=>paymentJson({error:{code:'controlled_payment_endpoint_retired'}},410));
