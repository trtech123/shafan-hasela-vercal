import {handleLive} from '../server/pelecard-live/handler.js';
import {sendLive} from '../server/pelecard-live/transport.js';
import {readAttempt,persistSession} from '../server/pelecard-live/database.js';
import {probeTls,probeDatabase} from '../server/pelecard-live/preflight.js';
export default {fetch(request){
 return handleLive(request,{read:name=>process.env[name],claim:id=>readAttempt('init',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),getAttempt:id=>readAttempt('lookup',id,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),send:sendLive,persist:(id,session)=>persistSession(id,session,process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL),preflight:async()=>{const [tls,database]=await Promise.all([probeTls(),probeDatabase(process.env.PELECARD_LIVE_ADAPTER_DATABASE_URL)]);return {tls,database};}});
}};
