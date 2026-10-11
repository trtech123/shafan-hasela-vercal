// Offline synthetic UI fixture. Never import production server or Supabase config.
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:https';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {build} from '../../app/node_modules/vite/dist/node/index.js';
import {validSignature} from '../../app/src/lib/signature.js';
import {normalizeIsraeliId} from '../../app/src/lib/israeliId.js';
import {renderUnsigned} from '../../app/server/order-confirmation/renderer.js';
import * as frozenText from '../../app/src/lib/orderDocText.js';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const tailwind=require('tailwindcss');
const tailwindConfig=require('tailwindcss/loadConfig')(fileURLToPath(new URL('../../app/tailwind.config.js',import.meta.url)));
const root=fileURLToPath(new URL('./',import.meta.url));
const src=fileURLToPath(new URL('../../app/src/',import.meta.url));

export async function fixture(origin) {
 const token=randomBytes(32).toString('base64url');
 const snapshot={data:{id:'00000000-0000-4000-8000-000000000001',order_number:'SYNTHETIC-MOBILE-QA',client_name:'Mobile Tester',total_price:120,vat_applicable:true,notes:'SYNTHETIC QA ONLY - NO REAL ORDER',quotation_snapshot:{selected_activities:[{activity_name:'Synthetic QA activity',quantity:2,price_per_person:60,line_total:120}]}},text:frozenText,renderVersion:'1',acceptanceVersion:'1',acceptanceText:'Synthetic QA acceptance only - no real order.'};
 const bytes=await renderUnsigned(snapshot,`${origin}/order-sign#${token}`);
 let signed=false;
 return {pdf:bytes, async api(body) {
  if(body.token!==token)return {status:404,body:{error:'link_unavailable'}};
  if(body.action==='pdf')return {status:200,pdf:bytes};
  if(body.action==='view')return {status:200,body:{signed,revision:{id:'00000000-0000-4000-8000-000000000001',revision_number:1,status:signed?'signed':'pending',expires_at:new Date(Date.now()+86400000).toISOString(),snapshot:{acceptanceText:'Synthetic QA acceptance only - no real order.'}}}};
  if(body.action==='sign'){
   if(body.signerId!==undefined&&normalizeIsraeliId(body.signerId)!=='012345674')return {status:400,body:{error:'invalid_signer_id'}};
   if(body.fullName!=='Mobile Tester'||body.accepted!==true||!validSignature({width:1,height:1,strokes:body.strokes})||!/^[0-9a-f-]{36}$/i.test(body.requestId||''))return {status:400,body:{error:'invalid_signature'}};
   signed=true;return {status:200,body:{ok:true}};
  }
  return {status:400,body:{error:'invalid_action'}};
 }};
}

export async function bundle() {
 const css=(await readFile(new URL('../../app/src/index.css',import.meta.url),'utf8')).replace(/^@import[^\r\n]+/gm,'');
 const output=await build({root,configFile:false,envFile:false,publicDir:false,logLevel:'error',
  resolve:{alias:[{find:'@/api/supabaseClient',replacement:'mobile-qa-supabase'},{find:'@',replacement:src},{find:'react',replacement:fileURLToPath(new URL('../../app/node_modules/react',import.meta.url))},{find:'react-dom',replacement:fileURLToPath(new URL('../../app/node_modules/react-dom',import.meta.url))}]},
  plugins:[{name:'isolated-mobile-qa',resolveId(id){if(['mobile-qa-supabase','mobile-qa.css'].includes(id))return '\0'+id;},load(id){if(id==='\0mobile-qa-supabase')return 'export const supabase={auth:{getSession(){throw new Error("Staff calls disabled in QA")}}};';if(id==='\0mobile-qa.css')return css;}}],
  esbuild:{jsx:'automatic'},css:{postcss:{plugins:[tailwind({content:[`${src.replaceAll('\\','/')}/pages/OrderSignature.jsx`,`${src.replaceAll('\\','/')}/components/{signatures,ui}/*.jsx`],theme:tailwindConfig.theme,plugins:tailwindConfig.plugins})]}},
  build:{write:false,sourcemap:false,rollupOptions:{input:fileURLToPath(new URL('mobile-qa.html',import.meta.url))}}});
 const files=new Map();
 for(const asset of output.output)files.set('/'+asset.fileName,Buffer.from(asset.type==='chunk'?asset.code:asset.source));
 return files;
}

export function handler(origin,files,state) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src blob:; frame-src blob:; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  const send=(status,type,body)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.headers.host!==new URL(origin).host)return send(421,'text/plain','Host rejected');
  if(req.method==='POST'&&req.url==='/api/order-confirmation'){
   if(req.headers.origin!==origin)return send(403,'text/plain','Origin rejected');
   try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>110000)return send(413,'text/plain','Too large');chunks.push(chunk);}
    const result=await state.api(JSON.parse(Buffer.concat(chunks).toString()));
    return send(result.status,result.pdf?'application/pdf':'application/json',result.pdf||JSON.stringify(result.body));
   }catch{return send(400,'application/json','{"error":"invalid_request"}');}
  }
  if(req.method!=='GET')return send(405,'text/plain','Method rejected');
  if(req.url==='/')return send(200,'text/html','<!doctype html><meta name="viewport" content="width=device-width"><h1>Synthetic mobile QA</h1><p>Use Mobile Tester and synthetic ID 012345674 only. Stop server after testing.</p><a href="/fixture.pdf">Open synthetic PDF; tap its signing link</a>');
  if(req.url==='/fixture.pdf')return send(200,'application/pdf',state.pdf);
  const path=req.url==='/order-sign'?'/mobile-qa.html':req.url;
  if(!files.has(path))return send(404,'text/plain','Not found');
  return send(200,path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',files.get(path));
 };
}

async function main(){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!['--host','--port','--cert','--key'].includes(args[i])||!args[i+1])throw new Error('Usage: node scripts/signatures/mobile-qa.mjs --cert cert.pem --key key.pem [--host private-ip] [--port 4188]');options[args[i]]=args[i+1];}
 const host=options['--host']||'127.0.0.1',port=Number(options['--port']||4188);
 if(isIP(host)!==4||!(/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a specific loopback or private IPv4 and port 1024-65535. Wildcard binding is forbidden.');
 if(!options['--cert']||!options['--key'])throw new Error('Explicit certificate and key paths required; see mobile QA instructions.');
 const origin=`https://${host}:${port}`;
 const tls={cert:await readFile(options['--cert']),key:await readFile(options['--key'])};
 const files=await bundle(),state=await fixture(origin);
 const server=createServer(tls,handler(origin,files,state));
 server.requestTimeout=15000;server.headersTimeout=10000;
 server.listen(port,host,()=>console.log(`Synthetic QA ready: ${origin}/ (Ctrl+C stops; restart resets)`));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error('QA startup failed. Check explicit certificate/key paths, host and dependencies.');process.exitCode=1;});
