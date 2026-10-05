import { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function RegisterSettings({ onSaved }) {
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const lock = useRef(false);
  const save = async (event) => {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const { error } = await supabase.rpc('save_cash_register', { p_code: code.trim(), p_name: name.trim(), p_active: true });
      if (error) throw error;
      setMessage('הקופה נשמרה. יש לפתוח מחדש טופס שובר פעיל כדי לבחור בה.'); setCode(''); setName(''); onSaved();
    } catch { setMessage('הקופה לא נשמרה. יש לבדוק קוד ושם והרשאת מנהל.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <details className="rounded border p-3"><summary>הגדרת קופה — מנהל מערכת</summary><p className="my-2 text-sm">קוד מפורש מזהה קופה. אין שיוך אוטומטי לפי אתר הפעילות. קוד קיים מעדכן את שם הקופה לשוברים חדשים.</p><form onSubmit={save} className="flex flex-wrap gap-2"><Input aria-label="קוד קופה" required pattern="[A-Z][A-Z0-9_]{1,31}" maxLength={32} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="קוד קופה באנגלית" /><Input aria-label="שם קופה" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="שם הקופה" /><Button disabled={busy}>שמירת קופה פעילה</Button></form>{message && <p role="status">{message}</p>}</details>;
}
