import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '@/api/supabaseClient';

const messages={
  provider_pending:'התשלום טרם אושר באופן סופי אצל פלאקארד. יש לבדוק את העסקה לפי מזהה התשלום.',
  provider_declined:'פלאקארד החזירה סירוב לעסקה. אין לסמן אותה כשולמה בלי בירור מול הספק.',
  provider_unavailable:'לא התקבלה תשובה ודאית מפלאקארד. יש לבדוק בדוחות הספק לפני כל ניסיון נוסף.',
  verification_mismatch:'נתוני העסקה או הקישור למושב התשלום אינם תואמים. נדרשת בדיקה ידנית.',
  recovery_not_run:'עסקה ממתינה לא נבדקה לאחרונה. יש לבדוק את מתזמן ההתאמה ואת דוחות פלאקארד.',
};
function useAlerts(){
  const [rows,setRows]=useState([]),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{let active=true;
    const refresh=async()=>{try{const {data,error}=await supabase.rpc('list_pelecard_pending_alerts');
      if(!active)return;
      if(error||!Array.isArray(data)){setUnavailable(true);return;}
      setRows(data);setUnavailable(false);
    }catch{if(active)setUnavailable(true);}};
    refresh();const timer=setInterval(refresh,30_000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  return {rows,unavailable};
}
export function PelecardPendingAlert(){
  const {rows,unavailable}=useAlerts();
  if(!rows.length&&!unavailable)return null;
  return <Link to="/accounting-operations" role="alert"
    className="block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">
    {unavailable?'בקרת עסקאות פלאקארד ממתינות אינה זמינה — יש לבדוק הנה״ח'
      :`${rows.length} תשלומי פלאקארד מחייבים בירור — פתחו את בקרת הנה״ח`}
  </Link>;
}
export default function PelecardPendingReview(){
  const {rows,unavailable}=useAlerts();
  return <section dir="rtl" aria-label="בדיקת תשלומי פלאקארד ממתינים"
    className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="text-lg font-bold">תשלומי פלאקארד שמחייבים בירור</h2>
    {unavailable?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-900">
      לא ניתן לטעון את רשימת התשלומים הממתינים. יש לבדוק את מצב העסקאות בדוחות הספק.
    </p>:rows.length?<>
      <p role="alert" className="rounded-lg bg-amber-100 p-3 text-amber-950">
        התוצאה הכספית אינה ודאית. אין לבצע חיוב חדש או להפיק חשבונית לפני התאמה מול פלאקארד.
      </p>
      <ul className="space-y-2">{rows.map(row=><li key={row.payment_id}
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <strong>{messages[row.last_reason]??'נדרשת בדיקה ידנית של העסקה.'}</strong>
        <span className="block font-mono text-xs">תשלום: {row.payment_id} · {row.source==='order'
          ?`הזמנה: ${row.order_number??'ללא מספר'}`:'מכירת קופה ממתינה'}</span>
        <span className="block text-xs">ניסיונות בירור: {row.checks}</span>
      </li>)}</ul>
    </>:<p className="text-sm text-muted-foreground">אין תשלומים חדשים שממתינים לבירור.</p>}
  </section>;
}
