import { useState } from 'react';
import { supabase } from '@/api/supabaseClient';

const reference = (value) => /^[A-Za-z0-9:/._-]{8,120}$/.test(value);
const payperUrl = (value) => /^https:\/\/(?:app\.)?payper\.co\.il\/(?:app\/)?public\/invoice_show\/[0-9]+(?:\?[^\s#]*)?$/.test(value);

/** Records an already-issued portal document. This component never calls an issuance endpoint. */
export default function RecordManualPayperDocument({ paymentId, amount, onRecorded }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [accountantRef, setAccountantRef] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ready = /^[1-9][0-9]*$/.test(number) && payperUrl(url) &&
    url.split('?')[0].endsWith(`/invoice_show/${number}`) &&
    issuedAt && reference(providerRef) && reference(accountantRef) && verified &&
    Number.isFinite(Number(amount)) && Number(amount) > 0;

  async function record(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(false);
    try {
      const { error: rpcError } = await supabase.rpc('record_payper_manual_document', {
        p_payment_id: paymentId, p_document_number: number, p_document_url: url,
        p_issued_at: new Date(issuedAt).toISOString(), p_amount: Number(amount),
        p_provider_confirmation_ref: providerRef, p_accountant_approval_ref: accountantRef,
      });
      if (rpcError) throw rpcError;
      onRecorded?.();
      setOpen(false);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs underline">
    רישום מסמך ידני מאומת
  </button>;
  return <form onSubmit={record} className="mt-3 space-y-2 rounded-lg border border-slate-300 bg-white p-3">
    <p className="text-xs">רישום מסמך שכבר הופק ב־Payper. הפעולה אינה מפיקה או שולחת מסמך.</p>
    <label className="block text-xs">מספר מסמך Payper<input className="block w-full border" value={number} onChange={e => setNumber(e.target.value)} /></label>
    <label className="block text-xs">קישור למסמך Payper<input className="block w-full border" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label className="block text-xs">מועד הפקה<input className="block w-full border" type="datetime-local" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} /></label>
    <label className="block text-xs">אסמכתת אישור Payper<input className="block w-full border" value={providerRef} onChange={e => setProviderRef(e.target.value)} /></label>
    <label className="block text-xs">אסמכתת אישור רואה חשבון<input className="block w-full border" value={accountantRef} onChange={e => setAccountantRef(e.target.value)} /></label>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />בדקתי שהמסמך קיים ומתאים לתשלום המאומת</label>
    {error && <p role="alert" className="text-xs text-rose-700">לא ניתן לשמור התאמה. יש לבדוק את הרשומה ואת אסמכתאות המסמך.</p>}
    <div className="flex gap-3"><button type="submit" disabled={!ready || busy} className="text-xs font-bold disabled:opacity-50">שמור התאמה</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs">ביטול</button></div>
  </form>;
}
