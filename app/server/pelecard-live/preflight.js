// Non-charging diagnostics exposed only by the signed, disabled-gate preflight action.
import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {Client} from 'pg';
import {ciphers} from './transport.js';
import {databaseOptions} from './database.js';
export function probeTls(request=https.request){
 return new Promise((resolve,reject)=>{
  const host='gateway20.pelecard.biz';
  const req=request({hostname:host,servername:host,port:443,path:'/',method:'HEAD',agent:false,minVersion:'TLSv1.2',maxVersion:'TLSv1.3',ciphers,rejectUnauthorized:true,checkServerIdentity,signal:AbortSignal.timeout(10000)},response=>{
   try{const socket=response.socket;if(socket.authorized!==true)throw new Error('tls_unavailable');const evidence={authorized:true,protocol:socket.getProtocol(),cipher:socket.getCipher().name,httpStatus:response.statusCode};response.destroy();resolve(evidence);}catch(error){response.destroy();reject(error);}
  });req.on('error',reject);req.end();
 });
}
export const diagnosticSql=`SELECT current_user AS current_user,
 COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS backend_ssl,
 has_function_privilege(current_user,'public.claim_pelecard_controlled_live_init(uuid)','EXECUTE') AS claim_execute,
 has_function_privilege(current_user,'public.get_pelecard_controlled_live_attempt(uuid)','EXECUTE') AS lookup_execute,
 has_function_privilege(current_user,'public.persist_pelecard_controlled_live_adapter_session(uuid,text,text,text)','EXECUTE') AS persist_execute,
 (SELECT count(*)::integer FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
 AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS accessible_public_tables,
 ARRAY(SELECT rolname FROM pg_catalog.pg_roles WHERE rolname<>current_user
 AND pg_has_role(current_user,oid,'MEMBER') ORDER BY rolname) AS memberships`;
export async function probeDatabase(connectionString,ClientClass=Client,orderMode=false){
 const client=new ClientClass({...databaseOptions(connectionString),options:'-c default_transaction_read_only=on'});
 try{
  await client.connect();const stream=client.connection?.stream;
  if(stream?.encrypted!==true||stream.authorized!==true)throw new Error('database_tls_unverified');
  const clientTls={encrypted:true,authorized:true,protocol:stream.getProtocol(),cipher:stream.getCipher().name};
  const {rows}=await client.query(orderMode?diagnosticSql.replaceAll('claim_pelecard_controlled_live_init','claim_pelecard_live_init').replaceAll('get_pelecard_controlled_live_attempt','get_pelecard_live_attempt').replaceAll('persist_pelecard_controlled_live_adapter_session','persist_pelecard_live_adapter_session'):diagnosticSql);const row=rows[0];
  return {currentUser:row.current_user,backendSsl:row.backend_ssl,clientTls,claimExecute:row.claim_execute,lookupExecute:row.lookup_execute,persistExecute:row.persist_execute,accessiblePublicTables:row.accessible_public_tables,memberships:row.memberships};
 }finally{await client.end();}
}
