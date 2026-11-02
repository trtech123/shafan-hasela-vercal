import {createPosFeedback} from '../pelecard-pos-payment/pos-handler.ts';
import {posRuntime} from '../pelecard-pos-payment/pos-runtime.ts';
import {paymentJson} from '../pelecard-order-payment/_deployed_shared/payment-http.ts';
Deno.serve(async request=>{try{return await createPosFeedback(posRuntime())(request);}catch{return paymentJson({error:{code:'invalid_configuration'}},503);}});
