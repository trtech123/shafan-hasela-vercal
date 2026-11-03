import {createCommercialFeedback} from '../pelecard-order-payment/_deployed_shared/pelecard-commercial.ts';
import {commercialRuntime} from '../pelecard-order-payment/_deployed_shared/pelecard-commercial-runtime.ts';
import {paymentJson} from '../pelecard-order-payment/_deployed_shared/payment-http.ts';

// Separate permanent server-side callback URL configured by the hosted order
// adapter. The shared handler requires stored correlation and read-only
// provider verification before any existing payment finalizer can run.
Deno.serve(async request=>{
  try{return await createCommercialFeedback(commercialRuntime())(request);}
  catch{return paymentJson({error:{code:'invalid_configuration'}},503);}
});
