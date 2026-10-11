import {createClient} from 'npm:@supabase/supabase-js@2.106.1';
import nodemailer from 'npm:nodemailer@10.0.13';
import {createSignatureDeliveryHandler} from './handler.js';
import {createWhatsappProvider} from '../send-order-doc/_deployed_shared/order-delivery/template.js';
import {createSignatureEmailProvider} from './email.js';
import {DeliveryError} from '../send-order-doc/_deployed_shared/order-delivery/contract.js';
const env=(key:string)=>Deno.env.get(key)||'';
const service=env('SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(env('SUPABASE_URL'),service,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(value).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function result(promise:PromiseLike<any>){const {data,error}=await promise;if(error)throw new DeliveryError(['link_unavailable','signature_forbidden','delivery_conflict','delivery_already_claimed','delivery_resend_stale','delivery_still_in_progress'].includes(error.message)?error.message:'delivery_unavailable',error.code==='PT409'?409:error.code==='PT404'?404:error.code==='42501'?403:503);return data;}
Deno.serve(createSignatureDeliveryHandler({
 authorize:async(request:Request)=>Boolean(service)&&request.headers.get('authorization')==='Bearer '+service,
 read:(revisionId:string,actorId:string)=>result(db.rpc('order_signature_action',{p_action:'staff_read',p_input:{revisionId,actorId}})),
 verifyLink:async(link:string,id:string)=>{
  let parsed:URL;try{parsed=new URL(link);}catch{throw new DeliveryError('link_unavailable',404);}
  if(parsed.origin!==env('ORDER_SIGNATURE_PUBLIC_ORIGIN')||parsed.pathname!=='/order-sign'||parsed.search||!/^#[A-Za-z0-9_-]{43}$/.test(parsed.hash))throw new DeliveryError('link_unavailable',404);
  const row=await result(db.rpc('order_signature_action',{p_action:'view',p_input:{tokenHash:await hash(new TextEncoder().encode(parsed.hash.slice(1)))}}));
  if(row.id!==id)throw new DeliveryError('link_unavailable',404);
 },
 download:async(path:string)=>new Uint8Array(await (await result(db.storage.from('order-signatures-private').download(path))).arrayBuffer()),hash,
 claim:(input:any)=>result(db.rpc('order_signature_delivery',{p_action:'claim',p_input:input})),
 finish:(input:any)=>result(db.rpc('order_signature_delivery',{p_action:'finish',p_input:input})),
 provider:(channel:string,link:string)=>channel==='whatsapp'?createWhatsappProvider({token:env('META_WHATSAPP_TOKEN'),phoneId:env('META_PHONE_NUMBER_ID'),wabaId:env('META_WABA_ID')}):createSignatureEmailProvider({
  user:env('GMAIL_USER'),password:env('GMAIL_APP_PASSWORD'),signingUrl:link,createTransport:nodemailer.createTransport,
 }),
}));
