import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

const LABELS = {
  mapping_required: 'נדרש מיפוי חשבונות', mapped: 'מוכן לבדיקה',
  manual_existing: 'נרשם ידנית בריווחית', ready: 'מוכן לשידור',
  reserved: 'השידור הוקצה; יש לבדוק תוצאה',
  response_saved: 'תשובת ריווחית נשמרה; ממתין לאימות',
  verified: 'אומת בריווחית', reconciliation_required: 'נדרשת התאמה ידנית',
  definitive_rejection: 'נדחה על ידי ריווחית',
};

function safePayperUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && !url.hash && ['payper.co.il', 'app.payper.co.il'].includes(url.hostname)
      && /^\/(?:app\/)?public\/invoice_show\/[1-9][0-9]*$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

export default function RivhitJournalStatus() {
  const [state, setState] = useState({ loading: true, error: false, control: null, sources: [], entries: [] });
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [control, sources, entries] = await Promise.all([
          supabase.from('rivhit_journal_control')
            .select('capture_enabled,posting_enabled,cutover_at').single(),
          supabase.from('rivhit_journal_sources')
            .select('id,payper_document_number,payper_document_url,state,captured_at,next_mapping_check_at')
            .order('captured_at', { ascending: false }).limit(100),
          supabase.from('rivhit_journal_entries')
            .select('id,source_id,status,provider_year,provider_month,provider_line,report_journal_id,hold_reason,reconciliation_evidence,created_at')
            .order('created_at', { ascending: false }).limit(1000),
        ]);
        if (control.error || sources.error || entries.error) throw new Error('journal_read_unavailable');
        if (active) setState({ loading: false, error: false, control: control.data, sources: sources.data ?? [], entries: entries.data ?? [] });
      } catch {
        if (active) setState({ loading: false, error: true, control: null, sources: [], entries: [] });
      }
    })();
    return () => { active = false; };
  }, []);
  const entriesBySource = new Map();
  for (const entry of state.entries) {
    const rows = entriesBySource.get(entry.source_id) ?? [];
    rows.push(entry);
    entriesBySource.set(entry.source_id, rows);
  }
  return <section dir="rtl" aria-label="התאמת פקודות יומן לריווחית" className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="text-lg font-bold">התאמת פקודות יומן לריווחית</h2>
    <p className="text-xs text-muted-foreground">מצב לקריאה בלבד, עד 100 המסמכים ו־1,000 הפקודות האחרונות. מסמך Payper ופקודת יומן בריווחית הם רשומות נפרדות; אין לשדר מחדש תוצאה לא ודאית.</p>
    {state.control && <p className="text-sm" role="status">
      קליטת מסמכים: {state.control.capture_enabled ? 'פעילה' : 'כבויה'} ·
      שידור לריווחית: {state.control.posting_enabled ? 'פעיל' : 'כבוי'}
      {state.control.cutover_at ? ` · מעבר החל מ־${new Date(state.control.cutover_at).toLocaleString('he-IL')}` : ''}
    </p>}
    {state.loading ? <p>טוען נתוני התאמה…</p> : state.error
      ? <p role="alert">לא ניתן לטעון את מצב פקודות היומן.</p>
      : state.sources.length === 0 ? <p>לא נקלטו מסמכים לסנכרון.</p>
        : <ul className="space-y-2">{state.sources.map((source) => {
          const entries = entriesBySource.get(source.id) ?? [];
          const url = safePayperUrl(source.payper_document_url);
          return <li key={source.id} className="rounded-lg border p-3 text-sm">
            <span className="block">מסמך Payper {source.payper_document_number} · {entries.length ? `${entries.length} פקודות` : LABELS[source.state] ?? 'מצב לא מוכר'}</span>
            {source.state === 'mapping_required' && source.next_mapping_check_at
              && new Date(source.next_mapping_check_at) > new Date()
              ? <span className="block">בדיקת המיפוי הבאה: {new Date(source.next_mapping_check_at).toLocaleString('he-IL')}</span> : null}
            {entries.map((entry) => <span key={entry.id} className="block">
              {LABELS[entry.status] ?? 'מצב לא מוכר'}
              {entry.provider_year && entry.provider_month && entry.provider_line
                ? ` · פקודת ריווחית ${entry.provider_year}/${entry.provider_month}/${entry.provider_line}` : ''}
              {entry.hold_reason ? ` · סיבת עצירה: ${entry.hold_reason}` : ''}
              {entry.reconciliation_evidence?.reportJournalId
                ? ` · מועמד להתאמה: ${entry.reconciliation_evidence.reportJournalId}` : ''}
            </span>)}
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-primary underline">מסמך Payper</a> : null}
          </li>;
        })}</ul>}
  </section>;
}
