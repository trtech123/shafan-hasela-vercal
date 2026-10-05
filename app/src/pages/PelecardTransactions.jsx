import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/lib/AuthContext';
import {requestPelecardTransactions} from '@/payments/pelecardTransactions';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Search,RefreshCw,ShieldCheck} from 'lucide-react';

/** @typedef {{id:string,transactionId:string,providerLocalTime:string|null,amountMinor:number|null,currency:string|null,currencyCode:string|null,status:string,operation:string,approvalNumber:string|null,voucherId:string|null,jParam:string|null,debitType:string|null,shvaResult:string|null,customer:{name:string|null,email:string|null,phone:string|null,cardholderId:string|null}}} Transaction */
const unavailable='לא זמין';
const statuses={succeeded:'הצליחה',failed:'נכשלה',unknown:'לא ידוע'};
const operations={charge:'חיוב',authorization:'אישור בלבד',refund:'זיכוי',cancellation:'ביטול',unknown:'לא ידוע'};
const errors={unauthorized:'יש להתחבר מחדש.',forbidden:'הגישה למנהלים בלבד.',retrieval_disabled:'אחזור העסקאות מושבת כעת.',invalid_request:'יש לבדוק את התאריכים או את מזהה העסקה. טווח מרבי: 31 ימים, ללא תאריך עתידי. שעה שאינה חד־משמעית במעבר שעון אינה נתמכת.',range_too_large:'התקבלו תוצאות רבות מדי. יש לצמצם את טווח התאריכים.',provider_timeout:'תם הזמן שהוקצב לתשובת פלאקארד. ניתן לנסות שוב.',provider_unavailable:'לא ניתן לקבל כרגע נתונים מפלאקארד.',invalid_provider_response:'לא ניתן להציג את נתוני פלאקארד בבטחה.',conflicting_provider_records:'התקבלו נתונים סותרים לאותה עסקה. יש לבדוק מול פלאקארד.',configuration_unavailable:'שירות אחזור העסקאות אינו מוגדר כעת.'};
const localInput=date=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const dateLabel=value=>value?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)} ${value.slice(11)}`:unavailable;
function money(row){
 if(row.amountMinor===null)return unavailable;
 if(!row.currency)return `${row.amountMinor} ביחידות הספק · מטבע ${row.currencyCode??unavailable}`;
 return new Intl.NumberFormat('he-IL',{style:'currency',currency:row.currency}).format(row.amountMinor/100);
}
function ContactDetails({customer}){
 const [revealed,setRevealed]=useState(false);
 return <details><summary className="cursor-pointer text-primary">פרטי לקוח</summary><dl className="mt-2 space-y-1 min-w-44 text-sm">
  <div><dt className="inline text-muted-foreground">שם: </dt><dd className="inline">{customer.name??unavailable}</dd></div>
  <div><dt className="inline text-muted-foreground">דוא״ל: </dt><dd className="inline break-all">{customer.email??unavailable}</dd></div>
  <div><dt className="inline text-muted-foreground">טלפון: </dt><dd className="inline" dir="auto">{customer.phone??unavailable}</dd></div>
  <div><dt className="inline text-muted-foreground">מזהה בעל הכרטיס: </dt><dd className="inline">{customer.cardholderId?(revealed?customer.cardholderId:'••••'+(customer.cardholderId.length>4?customer.cardholderId.slice(-4):'')):unavailable}</dd></div>
  {customer.cardholderId&&<button type="button" className="text-primary underline" onClick={()=>setRevealed(!revealed)}>{revealed?'הסתרת מזהה בעל הכרטיס':'הצגת מזהה בעל הכרטיס'}</button>}
 </dl></details>;
}

export default function PelecardTransactions(){
 const {user}=useAuth();
 const [start,setStart]=useState(()=>localInput(new Date(Date.now()-7*86400000)));
 const [end,setEnd]=useState(()=>localInput(new Date()));
 const [transactionId,setTransactionId]=useState('');
 const [search,setSearch]=useState('');const [status,setStatus]=useState('all');
 const [transactions,setTransactions]=useState(/** @type {Transaction[]} */([]));
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [loaded,setLoaded]=useState(false);
 const active=useRef(/** @type {AbortController|null} */(null));
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>{active.current?.abort();setTransactions([]);setLoaded(false);setBusy(false)},[user?.id,user?.role]);
 if(user?.role!=='admin')return <p role="alert">הגישה למנהלים בלבד.</p>;
 async function load(body){
  active.current?.abort();const controller=new AbortController();active.current=controller;
  setBusy(true);setError('');setTransactions([]);setLoaded(false);
  try{const result=await requestPelecardTransactions(body,controller.signal);if(!controller.signal.aborted){setTransactions(result.transactions);setLoaded(true)}}
  catch(e){if(!controller.signal.aborted)setError(errors[e.message]??errors.provider_unavailable)}
  finally{if(!controller.signal.aborted)setBusy(false)}
 }
 const query=search.trim().toLocaleLowerCase();
 const visible=transactions.filter(row=>(status==='all'||row.status===status)&&[row.transactionId,row.approvalNumber,row.voucherId,row.customer.name,row.customer.email,row.customer.phone,row.amountMinor===null?null:String(row.amountMinor/100)].some(v=>String(v??'').toLocaleLowerCase().includes(query)));
 return <section className="space-y-6" dir="rtl">
  <header><h1 className="text-2xl font-bold">עסקאות פלאקארד</h1><p className="text-muted-foreground mt-2">צפייה בעסקאות המסוף המוגדר. התאריכים והשעות לפי שעון ישראל.</p></header>
  <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4"/>צפייה בלבד · ללא שינוי עסקאות</div>
  <div className="rounded-xl border bg-card p-4 space-y-5">
   <form onSubmit={e=>{e.preventDefault();load({action:'range',start,end})}} className="flex flex-wrap items-end gap-4">
    <label className="space-y-1">מתאריך ושעה<Input aria-label="מתאריך ושעה" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} required/></label>
    <label className="space-y-1">עד תאריך ושעה<Input aria-label="עד תאריך ושעה" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} required/></label>
    <Button type="submit" disabled={busy}><RefreshCw className={busy?'h-4 w-4 ml-2 animate-spin':'h-4 w-4 ml-2'}/>טעינת עסקאות</Button>
    <p className="text-sm text-muted-foreground">עד 31 ימים ו־500 עסקאות בכל חיפוש</p>
   </form>
   <form onSubmit={e=>{e.preventDefault();load({action:'lookup',transactionId:transactionId.trim()})}} className="flex flex-wrap items-end gap-4 border-t pt-4">
    <label className="space-y-1">מזהה עסקת פלאקארד<Input aria-label="מזהה עסקת פלאקארד" inputMode="numeric" pattern="[1-9][0-9]{0,14}" maxLength={15} value={transactionId} onChange={e=>setTransactionId(e.target.value)} required/></label>
    <Button type="submit" variant="outline" disabled={busy}><Search className="h-4 w-4 ml-2"/>איתור עסקה</Button>
   </form>
  </div>
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {busy&&<p role="status">טוען עסקאות מפלאקארד…</p>}
  {loaded&&<div className="space-y-4">
   <div className="flex flex-wrap items-end gap-4"><label>חיפוש בתוצאות<Input aria-label="חיפוש בתוצאות" value={search} onChange={e=>setSearch(e.target.value)} placeholder="מזהה, אסמכתה, סכום או פרטי קשר"/></label><label>סטטוס<select aria-label="סטטוס" className="block rounded-md border bg-background p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">הכול</option><option value="succeeded">הצליחה</option><option value="failed">נכשלה</option><option value="unknown">לא ידוע</option></select></label><p aria-live="polite">מוצגות {visible.length} מתוך {transactions.length} עסקאות</p></div>
   <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-sm text-right"><thead className="bg-muted"><tr>{['תאריך ושעה','סכום','סטטוס','מזהה פלאקארד','אישור / אסמכתה','שובר','סוג עסקה / חיוב','פרטי לקוח'].map(label=><th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>
    {visible.map(row=><tr key={row.id} className="border-t align-top"><td className="p-3 whitespace-nowrap" dir="ltr">{dateLabel(row.providerLocalTime)}</td><td className="p-3 whitespace-nowrap">{money(row)}</td><td className="p-3">{statuses[row.status]??statuses.unknown}<span className="block text-muted-foreground">{row.shvaResult??unavailable}</span></td><td className="p-3 font-mono">{row.transactionId}</td><td className="p-3 font-mono">{row.approvalNumber??unavailable}</td><td className="p-3 font-mono">{row.voucherId??unavailable}</td><td className="p-3">{operations[row.operation]??operations.unknown}<span className="block text-muted-foreground" dir="ltr">J{row.jParam??'?'} / {row.debitType??'?'}</span></td><td className="p-3"><ContactDetails customer={row.customer}/></td></tr>)}
   </tbody></table>{!visible.length&&<p className="p-6 text-center text-muted-foreground">לא נמצאו עסקאות להצגה.</p>}</div>
   <p className="text-sm text-muted-foreground">פרטי לקוח מוצגים רק אם התקבלו מפלאקארד. מידע חסר מסומן ״לא זמין״. אישור בלבד אינו חיוב; התוצאות אינן משנות הזמנה או תשלום בשפן.</p>
  </div>}
 </section>;
}
