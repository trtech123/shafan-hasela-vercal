import {createCommercialFeedback} from '../_shared/pelecard-commercial.ts';
import {commercialRuntime} from '../_shared/pelecard-commercial-runtime.ts';
import {paymentJson} from '../_shared/payment-http.ts';
Deno.serve(async request=>{try{return await createCommercialFeedback(commercialRuntime())(request);}catch{return paymentJson({error:{code:'invalid_configuration'}},503);}});
