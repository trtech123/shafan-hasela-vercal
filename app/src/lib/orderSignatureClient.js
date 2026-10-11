import { supabase } from '@/api/supabaseClient';

export async function signatureRequest(body, {staff=false, signal}={}) {
 const headers={'Content-Type':'application/json'};
 if(staff){const {data,error}=await supabase.auth.getSession();if(error||!data?.session?.access_token)throw new Error('authentication_required');headers.Authorization=`Bearer ${data.session.access_token}`;}
 const timeout=AbortSignal.timeout(60000);
 const response=await fetch('/api/order-confirmation',{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,timeout]):timeout});
 if(!response.ok){let code='request_failed';try{code=(await response.json()).error || code;}catch{/* Never echo server content. */}throw new Error(code);}
 return response.headers.get('content-type')?.includes('application/pdf')?response.blob():response.json();
}

export function downloadConfirmation(blob,name) {
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=url;anchor.download=name;anchor.rel='noreferrer';anchor.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export function validSignerName(value) {
 if(typeof value!=='string')return false;
 const name=value.trim().normalize('NFC');
 return name.length>=3 && name.length<=120 && !/[\p{Cc}\p{Cf}<>]/u.test(name) && /^\p{L}[\p{L}\p{M}'’". -]*\s+\p{L}[\p{L}\p{M}'’". -]*$/u.test(name);
}

export const signatureStateText={awaiting_signature:'ממתין לחתימה',awaiting:'ממתין לחתימה',pending:'ממתין לחתימה',signing:'בתהליך חתימה',signed:'חתום',expired:'פג תוקף',revoked:'בוטל',superseded:'הוחלף בגרסה חדשה',preparing:'בהכנה'};
