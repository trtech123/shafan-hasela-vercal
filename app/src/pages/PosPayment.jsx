import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useAuth} from '@/lib/AuthContext';
import {supabase} from '@/api/supabaseClient';
import {Button} from '@/components/ui/button';
import {requestPosPayment,redirectPosPayment,posCheckoutRequestKey,posPendingKey,posPendingKeyForActor} from '@/payments/posPayments';
import {validOrderId} from '@/payments/orderPayments';

const labels={initiated:'הסל נשמר וממתין למעבר לדף התשלום',pending_provider:'ממתין לתוצאת פלאקארד',failed:'הבקשה בוטלה לפני מעבר לתשלום',timed_out:'תוצאת התשלום אינה ודאית',succeeded:'התשלום אומת והמכירה נשמרה'};

export default function PosPayment(){
  const {user}=useAuth();const location=useLocation();
  const pendingKey=posPendingKeyForActor(user?.id);
  const params=new URLSearchParams(location.search);
  const returnedId=params.get('returned')==='1'?params.get('paymentId'):null;
  const cart=location.state?.cart;
  const [view,setView]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const locked=useRef(false);const handledReturn=useRef(null);
  const [requestKey]=useState(()=>{
    const scoped=pendingKey?sessionStorage.getItem(pendingKey):null;
    if(scoped||validOrderId(location.state?.checkoutId))
      return posCheckoutRequestKey(location.state?.checkoutId,cart,scoped,()=>crypto.randomUUID(),user?.id);
    // Older checkout pointers remain available for status/recovery only. The
    // server checks ownership before returning or acting on an intent.
    return posCheckoutRequestKey(null,cart,sessionStorage.getItem(posPendingKey));
  });
  const allowed=(user?.role==='admin'||user?.role==='קופאי')&&validOrderId(user?.id);
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
      if(action==='initialize'||action==='cancel')body={action,requestKey};
      else body={action,paymentId:view.paymentId};
      const result=await requestPosPayment(supabase,body);setView(result);
      if(action==='cancel'||result.paid)sessionStorage.removeItem(pendingKey);
      if(action==='initialize'&&result.canResume&&result.redirectUrl&&
        Number.isFinite(result.hostedDeadlineMs)&&result.hostedDeadlineMs>performance.now())
        redirectPosPayment(result.redirectUrl);
    }catch{
      setError('תוצאת הניסיון אינה ודאית. בדקו את מצב התשלום הקיים; אין להתחיל חיוב נוסף.');
      try{setView(await requestPosPayment(supabase,{action:'status',requestKey}));}catch{/* Keep ambiguity visible. */}
    }finally{locked.current=false;setBusy(false);}
  };

  if(!allowed)return <main dir="rtl" className="p-8">התשלום זמין למנהל ולקופאי בלבד.</main>;
  return <main dir="rtl" className="max-w-xl mx-auto p-6 space-y-5 text-slate-900">
    <Link to="/cashregister" className="text-primary underline">חזרה לקופה</Link>
    <h1 className="text-2xl font-bold">פלאקארד — מכירת קופה</h1>
    <p className="text-sm text-slate-600">הסכום המחייב נקבע בשרת לפי מחירי הקטלוג וההנחה המאושרת. התשלום יתבצע בדף המאובטח של פלאקארד בלבד.</p>
    {error&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}
    {view?<section className="rounded-2xl border bg-white p-5 space-y-4">
      <p className="text-sm text-slate-600">סכום שמור לתשלום, כולל מע״מ רגיל</p>
      <p className="text-4xl font-bold">{(view.amountMinor/100).toFixed(2)} ₪</p>
      <p role="status">{labels[view.status]||'נדרשת בדיקת מצב'}</p>
      {view.paid&&<><p>מספר קבלה: {view.receiptNumber||'ממתין להצגה'}</p><Link to="/sales-report" className="text-primary underline">צפייה בדוח הקופה</Link></>}
      {!view.paid&&view.status==='initiated'&&!view.dispatchStarted&&<div className="flex gap-2"><Button disabled={busy} onClick={()=>act('initialize')}>המשך לדף התשלום המאובטח</Button><Button variant="outline" disabled={busy} onClick={()=>act('cancel')}>בטל סל שמור</Button></div>}
      {view.status==='initiated'&&view.dispatchStarted&&<p role="alert" className="text-amber-900">פתיחת דף התשלום התחילה אך תוצאתה אינה ודאית. אין להתחיל ניסיון נוסף; נדרש בירור של הניסיון הקיים.</p>}
      {!view.paid&&view.canVerify&&<Button variant="outline" disabled={busy} onClick={()=>act('verify')}>בדוק תוצאת תשלום</Button>}
      {view.status==='pending_provider'&&<p className="text-sm text-amber-900">חזרה מהדף או ביטול בדפדפן אינם הוכחה שלא בוצע חיוב. אין לפתוח ניסיון חדש עד לבירור.</p>}
      <Button variant="outline" disabled={busy} onClick={()=>act('status')}>רענן מצב</Button>
    </section>:<p role="alert">לא נמצא ניסיון תשלום קיים. חזרו לקופה ובחרו מוצרים או שירותים.</p>}
  </main>;
}
