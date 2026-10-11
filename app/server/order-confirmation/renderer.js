import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { PDFDocument, PDFName } from 'pdf-lib';
import { orderConfirmationModel } from '../../src/lib/orderConfirmation.js';

const font = readFileSync(new URL('./assets/Heebo.ttf', import.meta.url)).toString('base64');
const logo = readFileSync(new URL('../../public/shafan-logo.jpg', import.meta.url)).toString('base64');
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const money = value => value === null ? 'לא תועד' : `${Number(value).toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2})} ₪`;
const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0,10).split('-').reverse().join('/') : 'לא תועד';
const paragraph = value => `<p>${escape(value)}</p>`;
const paragraphs = values => values.map(paragraph).join('');
const numbered = values => `<ol>${values.map(value=>`<li>${escape(value)}</li>`).join('')}</ol>`;

function shell(body) {
 return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>
 @font-face{font-family:Heebo;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900}
 @page{size:A4;margin:15mm 15mm 18mm}*{box-sizing:border-box}html{font-family:Heebo,sans-serif;font-size:11pt;color:#1e293b;print-color-adjust:exact;-webkit-print-color-adjust:exact}body{margin:0;line-height:1.65}h1{font-size:25pt;margin:0}h2{font-size:15pt;margin:16pt 0 8pt;break-after:avoid}h3{font-size:12pt;margin:0;break-after:avoid}p{margin:3pt 0;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}li{margin:6pt 0;orphans:3;widows:3}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1pt solid #cbd5e1;padding-bottom:12pt}header img{width:130pt}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14pt}.card{border:1pt solid #e2e8f0;border-radius:6pt;padding:10pt;margin:8pt 0}.item-heading{break-inside:avoid}.total{font-size:16pt;font-weight:700}.sign-link{display:block;background:#dbeafe;color:#1e40af;text-decoration:underline;padding:12pt;border:1pt solid #93c5fd;font-weight:700}.acceptance{border:1pt solid #94a3b8;padding:12pt;margin:15pt 0;break-inside:avoid}.safety{break-before:page}.muted{font-size:9pt;color:#475569}.hash{direction:ltr;text-align:left;overflow-wrap:anywhere;font-family:monospace;font-size:8pt}footer{border-top:1pt solid #cbd5e1;margin-top:15pt;padding-top:8pt;font-size:8pt}.signature{width:100%;max-width:460pt;height:170pt;border:1pt solid #cbd5e1}a{overflow-wrap:anywhere}
 </style></head><body>${body}</body></html>`;
}

function validateSnapshot(snapshot) {
 const t=snapshot?.text;
 const required=['ORDER_TERMS_INTRO','MOBILE_CONTACT','SAFETY_TITLE','SAFETY_GROUP_FIELD','SAFETY_SIGNATURE','SAFETY_MINORS_HEADER','SAFETY_MINORS_TEXT','SAFETY_CONTACT'];
 if(!snapshot?.data || !['1','2'].includes(snapshot.renderVersion) || !t || required.some(key=>typeof t[key]!=='string'||!t[key].trim()) || ['ORDER_TERMS','SAFETY_RULES','SAFETY_DECLARATION'].some(key=>!Array.isArray(t[key])||!t[key].length||t[key].some(value=>typeof value!=='string'||!value.trim())) || !Array.isArray(t.SIGNATURE_BLOCK?.closing) || !snapshot.acceptanceText || !snapshot.acceptanceVersion)throw new Error('invalid_confirmation_snapshot');
 return t;
}

export function confirmationHtml(snapshot, signingUrl) {
 const t=validateSnapshot(snapshot),url=new URL(signingUrl);
 if(url.protocol!=='https:' || url.username || url.password)throw new Error('invalid_signing_url');
 const m=orderConfirmationModel(snapshot.data),c=m.customer;
 return shell(`<header><div><h1>אישור הזמנה</h1>${paragraph(m.orderNumber)}${paragraph(`תאריך ההזמנה: ${date(snapshot.data.created_at)}`)}${snapshot.revisionNumber?paragraph(`גרסה: ${snapshot.revisionNumber}`):''}</div><img src="data:image/jpeg;base64,${logo}" alt="${escape(t.BRAND?.name)}"></header>
 <div class="grid"><section><h2>פרטי לקוח</h2>${paragraphs([c.client_name,c.organization,c.client_phone,c.client_email])}</section><section><h2>פרטי האירוע</h2>${paragraphs([date(m.date),[m.start?.slice(0,5),m.end?.slice(0,5)].filter(Boolean).join('–'),m.site,m.participants===null?'':`${m.participants} משתתפים`])}</section></div>
 <section><h2>פרטי חיוב שמורים</h2>${paragraphs([c.billing_institution_name || 'שם לחיוב לא תועד',c.billing_company_id?`מספר זיהוי הלקוח לחיוב: ${c.billing_company_id}`:'',c.billing_accounting_email,[c.billing_address_line,c.billing_city,c.billing_postal_code,c.billing_country_code].filter(Boolean).join(', '),m.vatLabel])}</section>
 <section><h2>פעילויות ומוצרים</h2>${m.items.map(item=>`<div class="card"><div class="item-heading"><h3>${escape(item.name)}</h3>${paragraph(item.type==='product'?'מוצר':item.type==='activity'?'פעילות':'פריט שמור')}${paragraph(`כמות: ${item.quantity??'לא תועדה'} · מחיר יחידה: ${money(item.unit)} · סה״כ: ${money(item.total)}`)}${item.duration>0?paragraph(`${item.duration} שעות`):''}${paragraph([item.site,item.date?date(item.date):''].filter(Boolean).join(' · '))}</div>${paragraph(item.description)}</div>`).join('')}</section>
 <section>${paragraph(`סטטוס תשלום: ${m.paymentStatus}`)}${m.subtotal!==null?paragraph(`סכום הפריטים השמור בהצעה: ${money(m.subtotal)}`):''}${m.discount>0?paragraph(`הנחה שמורה בהצעה: ${money(m.discount)}`):''}<p class="total">סה״כ ההזמנה: ${escape(money(m.total))}</p>${paragraph(m.vatLabel)}</section>
 ${[['הערות להזמנה',m.notes],['הערות שמורות מהצעת המחיר',m.quotationNotes]].filter(([,value])=>value).map(([title,value])=>`<section><h2>${title}</h2>${paragraph(value)}</section>`).join('')}
 <section><h2>${escape(t.ORDER_TERMS_INTRO)}</h2>${numbered(t.ORDER_TERMS)}</section>
 <section class="acceptance"><h2>אישור וחתימה דיגיטלית</h2>${paragraph(snapshot.acceptanceText)}<a class="sign-link" href="${escape(url.href)}">לצפייה באישור ההזמנה ולחתימה דיגיטלית</a><p class="muted">החתימה מתייחסת לגרסה זו ולתנאיה הכלליים בלבד. הצהרות הבטיחות והקטינים להלן דורשות אישורים נפרדים; החתימה הדיגיטלית אינה ממלאת אותן.</p></section>
 ${paragraphs(t.SIGNATURE_BLOCK.closing || [])}${paragraph(t.MOBILE_CONTACT)}
 <section class="safety"><h2>${escape(t.SAFETY_TITLE)}</h2>${paragraph(t.SAFETY_GROUP_FIELD)}${numbered(t.SAFETY_RULES)}${paragraphs(t.SAFETY_DECLARATION)}${paragraph(t.SAFETY_SIGNATURE)}<h3>${escape(t.SAFETY_MINORS_HEADER)}</h3>${paragraph(t.SAFETY_MINORS_TEXT)}${paragraph(t.SAFETY_SIGNATURE)}</section><footer>${escape(t.SAFETY_CONTACT)}<p>גרסת מסמך: ${escape(snapshot.renderVersion)} · גרסת הסכמה: ${escape(snapshot.acceptanceVersion)}</p></footer>`);
}

function signatureSvg(strokes) {
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>64)throw new Error('invalid_signature');
 let count=0,distinct=false;
 const paths=strokes.map(stroke=>{
  if(!Array.isArray(stroke)||stroke.length<2||stroke.length>512)throw new Error('invalid_signature');
  count+=stroke.length;
  for(const point of stroke){if(!point || typeof point.x!=='number' || typeof point.y!=='number' || !Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)throw new Error('invalid_signature');if(point.x!==stroke[0].x||point.y!==stroke[0].y)distinct=true;}
  return `<polyline points="${stroke.map(point=>`${(point.x*640).toFixed(3)},${(point.y*240).toFixed(3)}`).join(' ')}"/>`;
 });
 if(count>4096||!distinct)throw new Error('invalid_signature');
 return `<svg class="signature" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240" role="img" aria-label="חתימת הלקוח"><g fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${paths.join('')}</g></svg>`;
}

export function evidenceHtml(evidence) {
 const signedAt=new Date(evidence.signedAt);
 if(!Number.isFinite(signedAt.getTime())||typeof evidence.fullName!=='string'||evidence.fullName.trim().length<2||evidence.fullName.length>120||!evidence.acceptanceText)throw new Error('invalid_signature_evidence');
 return shell(`<h1>אישור וחתימה דיגיטלית</h1><p>המסמך המקורי מופיע בעמודים הקודמים. חתימה זו קשורה רק לגרסה המזוהה להלן.</p><section class="acceptance">${paragraph(evidence.acceptanceText)}${paragraph(`שם החותם: ${evidence.fullName}`)}${evidence.signerId?paragraph(`תעודת זהות: ${evidence.signerId}`):''}${paragraph(`תאריך ושעת חתימה (שעון ישראל): ${signedAt.toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}`)}<p>חתימה — אישור הלקוח להזמנה ולתנאים הכלליים:</p>${signatureSvg(evidence.strokes)}</section><p>אישור מפורש של ההזמנה והתנאים הכלליים. אין בכך חתימה על הצהרות בטיחות או קטינים נפרדות.</p><p>מזהה גרסת האישור:</p><p class="hash">${escape(evidence.revisionId)}</p><p>טביעת גרסת האישור (SHA-256):</p><p class="hash">${escape(evidence.revisionHash)}</p><p>טביעת המסמך המקורי (SHA-256):</p><p class="hash">${escape(evidence.unsignedHash)}</p><p>גרסת הסכמה: ${escape(evidence.acceptanceVersion)}</p>`);
}

async function launch() {
 // A local executable is exclusively a development/test setting; production
 // uses the packaged serverless Chromium, never an external renderer service.
 const local=process.env.CONFIRMATION_CHROMIUM_PATH || (process.platform==='win32'?['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync):null);
 return puppeteer.launch({executablePath:local || await chromium.executablePath(),args:local?[]:chromium.args,headless:true,timeout:20000});
}

async function render(html) {
 if(Buffer.byteLength(html)>4_000_000)throw new Error('confirmation_too_large');
 const browser=await launch();
 try{
  const page=await browser.newPage();
  await page.setViewport({width:1024,height:768,deviceScaleFactor:2});
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request',request=>{if(request.url().startsWith('data:')||request.url()==='about:blank')void request.continue();else void request.abort();});
  await page.setContent(html,{waitUntil:'load',timeout:15000});
  const signature=await page.$('svg.signature');
  if(signature){
   // Flatten only the trusted, bounded signature drawing into high-resolution
   // PNG ink. Reader-specific vector clipping/printing behavior must not control
   // visibility of acceptance evidence. Original confirmation pages stay intact.
   const ink=await signature.screenshot({type:'png',omitBackground:false});
   const image=`<img class="signature" alt="חתימת הלקוח" src="data:image/png;base64,${Buffer.from(ink).toString('base64')}">`;
   await page.setContent(html.replace(/<svg class="signature"[\s\S]*?<\/svg>/,image),{waitUntil:'load',timeout:15000});
  }
  const bytes=Buffer.from(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,waitForFonts:true,timeout:20000}));
  const pdf=await PDFDocument.load(bytes);
  if(pdf.getPageCount()>100||bytes.length>10*1024*1024)throw new Error('confirmation_too_large');
  return bytes;
 }finally{await browser.close();}
}

export function renderUnsigned(snapshot, signingUrl) { return render(confirmationHtml(snapshot,signingUrl)); }

export async function renderSigned(unsignedBytes, evidence) {
 if(createHash('sha256').update(unsignedBytes).digest('hex')!==evidence.unsignedHash)throw new Error('unsigned_artifact_hash_mismatch');
 const original=await PDFDocument.load(unsignedBytes);
 const appendix=await PDFDocument.load(await render(evidenceHtml(evidence)));
 const pages=await original.copyPages(appendix,appendix.getPageIndices());
 for(const page of pages)original.addPage(page);
 // Preserve the byte-for-byte unsigned original, not only its visual pages.
 await original.attach(unsignedBytes,'original-confirmation.pdf',{mimeType:'application/pdf',description:'Original frozen confirmation; SHA-256 '+evidence.unsignedHash});
 // Preserve frozen pages, but open new signed artifacts at the actual ink.
 // This is a standard PDF destination, not a script or external viewer link.
 original.catalog.set(PDFName.of('OpenAction'),original.context.obj([pages[0].ref,PDFName.of('Fit')]));
 original.setTitle('אישור הזמנה חתום');
 const signed=Buffer.from(await original.save());
 if(signed.length>10*1024*1024)throw new Error('confirmation_too_large');
 return signed;
}
