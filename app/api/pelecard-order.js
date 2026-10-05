import {handleOrderLive} from '../server/pelecard-live/handler.js';
import {sendOrderLive,inspectHostedPage} from '../server/pelecard-live/order-transport.js';
import {readOrderAttempt,persistOrderSession} from '../server/pelecard-live/database.js';
import {probeTls,probeDatabase} from '../server/pelecard-live/preflight.js';
export default {fetch(request){
 return handleOrderLive(request,{read:name=>process.env[name],claim:id=>readOrderAttempt('init',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),getAttempt:id=>readOrderAttempt('lookup',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),send:sendOrderLive,hosted:inspectHostedPage,persist:(id,session)=>persistOrderSession(id,session,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),preflight:async()=>{const [tls,database]=await Promise.all([probeTls(),probeDatabase(process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL,undefined,true)]);return {tls,database};}});
}};
