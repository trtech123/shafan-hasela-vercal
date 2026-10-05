import {Client} from 'pg';
import {readFileSync} from 'node:fs';
const ca=readFileSync(new URL('./certs/supabase-prod-ca-2021.crt',import.meta.url),'utf8');
export function databaseOptions(value){
 const url=new URL(value);
 if(url.protocol!=='postgresql:'||url.search||url.hash||url.pathname!=='/postgres'||url.hostname!=='aws-1-ap-southeast-2.pooler.supabase.com'||decodeURIComponent(url.username)!=='pelecard_controlled_live_adapter_login.divzxsynczeifkpnpupl'||!url.password||!['5432','6543'].includes(url.port))throw new Error('invalid_database_configuration');
 return {host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:'postgres',ssl:{ca,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:5000,application_name:'pelecard-controlled-live-adapter'};
}
export async function readAttempt(action,id,connectionString,ClientClass=Client){
 if(!['init','lookup','validate'].includes(action))throw new Error('invalid_action');
 const client=new ClientClass(databaseOptions(connectionString));
 try{await client.connect();const result=await client.query(action==='init'?'SELECT amount_minor, currency, order_id FROM public.claim_pelecard_controlled_live_init($1::uuid)':'SELECT payment_id, order_id, amount_minor, currency, transaction_id, confirmation_key FROM public.get_pelecard_controlled_live_attempt($1::uuid)',[id]);if(result.rows.length>1)throw new Error('invalid_attempt');return result.rows[0]??null;}finally{await client.end();}
}
export async function persistSession(id,session,connectionString,ClientClass=Client){
 const client=new ClientClass(databaseOptions(connectionString));
 try{
  await client.connect();
  const result=await client.query('SELECT public.persist_pelecard_controlled_live_adapter_session($1::uuid,$2::text,$3::text,$4::text) AS session',[id,session.TransactionId,session.ConfirmationKey,session.URL]);
  const saved=result.rows[0]?.session;
  if(result.rows.length!==1||saved?.id!==id||saved.provider_session_id!==session.TransactionId||saved.provider_redirect_url!==session.URL||saved.status!=='pending_provider')throw new Error('invalid_persistence_acknowledgment');
 }finally{await client.end();}
}

export async function readOrderAttempt(action,id,connectionString,ClientClass=Client){
 if(!['init','lookup','validate','hosted'].includes(action))throw Error('invalid_action');
 const client=new ClientClass(databaseOptions(connectionString));
 try{await client.connect();const result=await client.query(action==='init'?'SELECT amount_minor,currency,order_id FROM public.claim_pelecard_live_init($1::uuid)':'SELECT payment_id,order_id,amount_minor,currency,transaction_id,confirmation_key,hosted_state FROM public.get_pelecard_live_attempt($1::uuid)',[id]);if(result.rows.length>1)throw Error('invalid_attempt');return result.rows[0]??null;}finally{await client.end();}
}
export async function persistOrderSession(id,session,connectionString,ClientClass=Client){
 const client=new ClientClass(databaseOptions(connectionString));try{await client.connect();const result=await client.query('SELECT public.persist_pelecard_live_adapter_session($1::uuid,$2::text,$3::text,$4::text) AS session',[id,session.TransactionId,session.ConfirmationKey,session.URL]);const saved=result.rows[0]?.session;if(saved?.id!==id||saved.provider_session_id!==session.TransactionId||saved.status!=='pending_provider')throw Error('invalid_persistence_acknowledgment');}finally{await client.end();}
}
