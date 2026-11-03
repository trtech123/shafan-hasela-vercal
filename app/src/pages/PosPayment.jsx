import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useAuth} from '@/lib/AuthContext';
import {supabase} from '@/api/supabaseClient';
import {Button} from '@/components/ui/button';
import {billingReviewIssues} from '@/payments/payperBilling';
import {requestPosPayment,redirectPosPayment,posPaymentErrorMessage} from '@/payments/posPayments';
import {validOrderId} from '@/payments/orderPayments';

const pendingKey='pelecard.posPending.v1';
const emptyBilling={kind:'person',name:'',identity:'',email:''};
const labels={initiated:'הסל נשמר וממתין למעבר לדף התשלום',pending_provider:'ממתין לתוצאת פלאקארד',failed:'הבקשה בוטלה לפני מעבר לתשלום',timed_out:'תוצאת התשלום אינה ודאית',succeeded:'התשלום אומת והמכירה נשמרה'};

export default function PosPayment(){
  const {user}=useAuth();const location=useLocation();
  const params=new URLSearchParams(location.search);
  const returnedId=params.get('returned')==='1'?params.get('paymentId'):null;
  const cart=location.state?.cart;
  const [billing,setBilling]=useState(emptyBilling);
  const [showIdentity,setShowIdentity]=useState(false);
  const [view,setView]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const locked=useRef(false);const handledReturn=useRef(null);
  const [requestKey]=useState(()=>{
    try{const saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
      if(saved&&validOrderId(saved.requestKey)&&(!cart||saved.cart===JSON.stringify(cart)))return saved.requestKey;
    }catch{/* Start with a new key. */}
    return crypto.randomUUID();
  });
  const allowed=user?.role==='admin'||user?.role==='קופאי';
  const discountAllowed=!cart?.discount||user?.role==='admin';
  useEffect(()=>{if(view?.paid)sessionStorage.removeItem(pendingKey);},[view?.paid]);

  useEffect(()=>{
    if(!allowed)return;
    let active=true;
    const locate=returnedId&&validOrderId(returnedId)?{paymentId:returnedId}:{requestKey};
    const load=async()=>{
      try{
        const saved=await requestPosPayment(supabase,{action:'status',...locate});
        if(!active)return;setView(saved);
        if(returnedId&&returnedId===saved.paymentId&&saved.canVerify&&handledReturn.current!==returnedId){
          handledReturn.current=returnedId;
          const clean=new URL(window.location.href);clean.searchParams.delete('returned');
          window.history.replaceState(window.history.state,'',clean.pathname+clean.search);
          try{const checked=await requestPosPayment(supabase,{action:'verify',paymentId:returnedId});if(active)setView(checked);}
          catch{if(active)setError('תוצאת התשלום אינה ודאית. בדקו את הניסיון הקיים; אין להתחיל חיוב נוסף.');}
        }
      }catch{/* No intent yet is normal before preparation. */}
    };load();return()=>{active=false};
  },[allowed,requestKey,returnedId]);

  const act=async(action)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{
      let body;
      if(action==='prepare'){
        if(!cart?.lines?.length||!discountAllowed)throw Error('cart_unavailable');
        sessionStorage.setItem(pendingKey,JSON.stringify({requestKey,cart:JSON.stringify(cart)}));
        body={action,requestKey,lines:cart.lines,discount:cart.discount??null,billing};
      }else if(action==='initialize'||action==='cancel')body={action,requestKey};
      else body={action,paymentId:view.paymentId};
      const result=await requestPosPayment(supabase,body);setView(result);
      if(action==='cancel'||result.paid)sessionStorage.removeItem(pendingKey);
      if(action==='initialize'&&result.canResume&&result.redirectUrl&&
        Number.isFinite(result.hostedDeadlineMs)&&result.hostedDeadlineMs>performance.now())
        redirectPosPayment(result.redirectUrl);
    }catch(error){
      setError(action==='prepare'?posPaymentErrorMessage(error?.code):
        'תוצאת הניסיון אינה ודאית. בדקו את מצב התשלום הקיים; אין להתחיל חיוב נוסף.');
      try{setView(await requestPosPayment(supabase,{action:'status',requestKey}));}catch{/* Keep ambiguity visible. */}
    }finally{locked.current=false;setBusy(false);}
  };

  if(!allowed)return <main dir="rtl" className="p-8">התשלום זמין למנהל ולקופאי בלבד.</main>;
  return <main dir="rtl" className="max-w-xl mx-auto p-6 space-y-5 text-slate-900">
    <Link to="/cashregister" className="text-primary underline">חזרה לקופה</Link>
    <h1 className="text-2xl font-bold">פלאקארד — מכירת קופה</h1>
    <p className="text-sm text-slate-600">הסכום המחייב נקבע בשרת לפי מחירי הקטלוג וההנחה המאושרת. התשלום יתבצע בדף המאובטח של פלאקארד בלבד.</p>
    {error&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}
    {!discountAllowed&&<p role="alert">הנחה בתשלום פלאקארד מחייבת אישור מנהל.</p>}
    {view?<section className="rounded-2xl border bg-white p-5 space-y-4">
      <p className="text-sm text-slate-600">סכום שמור לתשלום, כולל מע״מ רגיל</p>
      <p className="text-4xl font-bold">{(view.amountMinor/100).toFixed(2)} ₪</p>
      <p role="status">{labels[view.status]||'נדרשת בדיקת מצב'}</p>
      {view.paid&&<><p>מספר קבלה: {view.receiptNumber||'ממתין להצגה'}</p><Link to="/sales-report" className="text-primary underline">צפייה בדוח הקופה</Link></>}
      {!view.paid&&view.status==='initiated'&&!view.dispatchStarted&&<div className="flex gap-2"><Button disabled={busy} onClick={()=>act('initialize')}>המשך לדף התשלום המאובטח</Button><Button variant="outline" disabled={busy} onClick={()=>act('cancel')}>בטל סל שמור</Button></div>}
      {view.status==='initiated'&&view.dispatchStarted&&<p role="alert" className="text-amber-900">פתיחת דף התשלום התחילה אך תוצאתה אינה ודאית. אין להתחיל ניסיון נוסף; נדרש בירור של הניסיון הקיים.</p>}
      {!view.paid&&view.canResume&&<Button disabled={busy} onClick={()=>redirectPosPayment(view.redirectUrl)}>המשך לניסיון התשלום הקיים</Button>}
      {!view.paid&&view.canVerify&&<Button variant="outline" disabled={busy} onClick={()=>act('verify')}>בדוק תוצאת תשלום</Button>}
      {view.status==='pending_provider'&&<p className="text-sm text-amber-900">חזרה מהדף או ביטול בדפדפן אינם הוכחה שלא בוצע חיוב. אין לפתוח ניסיון חדש עד לבירור.</p>}
      <Button variant="outline" disabled={busy} onClick={()=>act('status')}>רענן מצב</Button>
    </section>:cart&&discountAllowed?<section className="rounded-2xl border bg-white p-5 space-y-3" aria-label="פרטי חיוב לפני התשלום">
      <h2 className="font-semibold">פרטי חיוב למסמך</h2>
      <p className="text-sm text-slate-600">פרטים חסרים יועברו לבדיקה ידנית לאחר תשלום מאומת; לא יופק מסמך עם זהות מומצאת.</p>
      <label className="block">סוג לקוח<select className="w-full border rounded p-2" value={billing.kind} onChange={e=>setBilling({...billing,kind:e.target.value})}><option value="person">יחיד</option><option value="organization">חברה</option></select></label>
      <label className="block">{billing.kind==='organization'?'שם חברה רשום':'שם מלא'}<input className="w-full border rounded p-2" maxLength={200} value={billing.name} onChange={e=>setBilling({...billing,name:e.target.value})}/></label>
      <label className="block">{billing.kind==='organization'?'מספר חברה':'מספר תעודת זהות'}<span className="flex gap-2"><input className="min-w-0 flex-1 border rounded p-2" dir="ltr" type={showIdentity?'text':'password'} inputMode="numeric" autoComplete="off" maxLength={9} value={billing.identity} onChange={e=>setBilling({...billing,identity:e.target.value})}/><Button type="button" variant="outline" onClick={()=>setShowIdentity(!showIdentity)}>{showIdentity?'הסתר':'הצג'}</Button></span></label>
      <label className="block">דוא״ל למסמך<input className="w-full border rounded p-2" dir="ltr" type="email" maxLength={320} value={billing.email} onChange={e=>setBilling({...billing,email:e.target.value})}/></label>
      {billingReviewIssues(billing).length>0&&<p role="note" className="text-sm text-amber-900">פרטי החיוב עדיין אינם מלאים. לאחר תשלום, המסמך יועבר לבדיקה ידנית.</p>}
      <Button disabled={busy} onClick={()=>act('prepare')}>שמור סל ובדוק את הסכום בשרת</Button>
    </section>:<p role="alert">לא נמצא סל קופה לתשלום. חזרו לקופה ובחרו מוצרים או שירותים.</p>}
  </main>;
}
