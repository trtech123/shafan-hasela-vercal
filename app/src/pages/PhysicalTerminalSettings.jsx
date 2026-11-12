import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { listPhysicalTerminalSettings, savePhysicalTerminalSetting } from '@/payments/physical/settings';

export default function PhysicalTerminalSettings() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [registers, setRegisters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let active = true;
    Promise.all([
      listPhysicalTerminalSettings(supabase),
      supabase.from('cash_registers').select('code,name,active').order('code'),
    ]).then(([rows, registerResult]) => {
      if (!active) return;
      if (registerResult.error) throw new Error('registers_unavailable');
      setDevices(rows);
      setDrafts(Object.fromEntries(rows.map(row => [row.registerNumber, row])));
      setRegisters(registerResult.data || []);
    }).catch(() => { if (active) setError('לא ניתן לטעון את הגדרות המסופונים'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.role]);

  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  const update = (number, patch) => setDrafts(previous => ({
    ...previous, [number]: { ...previous[number], ...patch },
  }));

  const save = async number => {
    setSaving(number); setError('');
    try {
      const row = await savePhysicalTerminalSetting(supabase, drafts[number]);
      setDevices(previous => previous.map(item => item.registerNumber === number ? row : item));
      setDrafts(previous => ({ ...previous, [number]: row }));
    } catch { setError('שמירת המסופון נכשלה. בדקו שהעמדה פעילה ואינה משויכת למסופון אחר.'); }
    finally { setSaving(null); }
  };

  const addWorkstation = async event => {
    event.preventDefault(); setSaving('workstation'); setError('');
    try {
      const code = newCode.trim().toUpperCase();
      const name = newName.trim();
      if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(code) || !name || name.length > 120)
        throw new Error('invalid_workstation');
      const { data, error: saveError } = await supabase.rpc('save_cash_register', {
        p_code: code, p_name: name, p_active: true,
      });
      if (saveError || !data?.code) throw new Error('save_failed');
      setRegisters(previous => [...previous.filter(item => item.code !== data.code), data]
        .sort((a, b) => a.code.localeCompare(b.code)));
      setNewCode(''); setNewName('');
    } catch { setError('שמירת עמדת הקופה נכשלה'); }
    finally { setSaving(null); }
  };

  return <div className="space-y-6" dir="rtl">
    <header>
      <h1 className="text-2xl font-bold">הגדרות מסופונים פיזיים</h1>
      <p className="mt-2 text-sm text-slate-600">מסוף בית עסק 2814926. שיוך מסופון לעמדת קופה נקבע כאן על ידי מנהל בלבד.</p>
      <p className="mt-1 text-sm text-amber-800">הגדרות אלו אינן מפעילות סליקה. ממשק הענן הפיזי עדיין ממתין לאישור פלאקארד.</p>
    </header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {loading ? <p>טוען הגדרות…</p> : <div className="grid gap-4 md:grid-cols-2">
      {devices.map(device => {
        const draft = drafts[device.registerNumber] || device;
        const number = device.registerNumber;
        return <section key={number} className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">{device.model} — {number}</h2>
          <label className="block text-sm">שם מסופון {number}
            <input className="mt-1 block w-full rounded-lg border p-2" value={draft.label}
              onChange={event => update(number, { label: event.target.value })} />
          </label>
          <label className="block text-sm">עמדת קופה {number}
            <select className="mt-1 block w-full rounded-lg border p-2" value={draft.cashRegisterCode || ''}
              onChange={event => update(number, { cashRegisterCode: event.target.value || null })}>
              <option value="">ללא שיוך</option>
              {registers.filter(item => item.active || item.code === draft.cashRegisterCode).map(item =>
                <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={event => update(number, { enabled: event.target.checked })} />
            מסופון {number} פעיל
          </label>
          <button type="button" disabled={saving !== null || (draft.enabled && !draft.cashRegisterCode)}
            onClick={() => save(number)} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            שמירת מסופון {number}
          </button>
        </section>;
      })}
    </div>}
    <form onSubmit={addWorkstation} className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="font-semibold">הוספת עמדת קופה לשיוך</h2>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">קוד עמדה
          <input className="mt-1 block rounded-lg border p-2" value={newCode} onChange={event => setNewCode(event.target.value)} placeholder="FRONT" />
        </label>
        <label className="text-sm">שם עמדה
          <input className="mt-1 block rounded-lg border p-2" value={newName} onChange={event => setNewName(event.target.value)} placeholder="קופה ראשית" />
        </label>
      </div>
      <button disabled={saving !== null} className="rounded-lg border px-4 py-2 disabled:opacity-50">הוספת עמדה</button>
    </form>
  </div>;
}
