import {signatureRuntime} from '../server/order-confirmation/runtime.js';
export default {async fetch(request) {
  try{return await signatureRuntime()(request);}
  catch{return new Response(JSON.stringify({error:'server_not_configured'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
}};
