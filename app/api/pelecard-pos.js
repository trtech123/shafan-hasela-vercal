import {handlePosLive} from '../server/pelecard-live/handler.js';
import {sendPosLive,inspectHostedPage} from '../server/pelecard-live/order-transport.js';
import {readPosAttempt,persistPosSession} from '../server/pelecard-live/database.js';
import {probeTls,probeDatabase} from '../server/pelecard-live/preflight.js';
export default {fetch(request){
 return handlePosLive(request,{read:name=>process.env[name],claim:id=>readPosAttempt('init',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),getAttempt:id=>readPosAttempt('lookup',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),send:sendPosLive,hosted:inspectHostedPage,persist:(id,session)=>persistPosSession(id,session,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),preflight:async()=>{const [tls,database]=await Promise.all([probeTls(),probeDatabase(process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL,undefined,true)]);return {tls,database};}});
}};
