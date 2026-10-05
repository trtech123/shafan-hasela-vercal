import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { canManageCustomers, customerErrorMessage } from '@/lib/customers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CustomerFormDialog from './CustomerFormDialog';
import useCustomerSearch from './useCustomerSearch';

export default function CustomerSelector({ value, onSelect, onClear, initialValues = {} }) {
  const { user } = useAuth();
  const allowed = canManageCustomers(user?.role);
  const [search, setSearch] = useState('');
  const [engaged, setEngaged] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const [dialog, setDialog] = useState(null);
  const results = useCustomerSearch(search, { enabled: allowed && engaged, revision });
  useEffect(() => {
    let active = true;
    setSelected(null); setError('');
    if (!value || !allowed) return;
    (async () => {
      try {
        const { data, error: loadError } = await supabase.from('customers').select('*').eq('id', value).single();
        if (loadError) throw loadError;
        if (active) setSelected(data);
      } catch (loadError) { if (active) setError(customerErrorMessage(loadError)); }
    })();
    return () => { active = false; };
  }, [value, allowed, loadRevision]);
  if (!allowed) return null;
  return <section className="space-y-3 rounded-lg border p-4" aria-label="בחירת לקוח">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">כרטיס לקוח</h3><Button type="button" variant="outline" onClick={() => setDialog('create')}>לקוח חדש</Button></div>
    {selected && <div className="rounded-md bg-muted p-3 space-y-2">
      <p className="font-medium">{selected.display_name}{selected.archived_at && ' (בארכיון)'}</p>
      <p className="text-sm break-words">{[selected.organization_name, selected.phone, selected.email].filter(Boolean).join(' · ')}</p>
      <p className="text-sm">מדיניות מע״מ בכרטיס: {selected.vat_applicable === true ? 'חייב במע״מ' : selected.vat_applicable === false ? 'לא חייב במע״מ' : 'נדרשת בחירה מפורשת'}</p>
      {!selected.archived_at && <Button type="button" variant="outline" size="sm" onClick={() => { setEngaged(false); onSelect(selected); }}>בחירת כרטיס זה</Button>}
      <div className="flex flex-wrap gap-2">{!selected.archived_at && <Button type="button" variant="outline" size="sm" onClick={() => setDialog('edit')}>עריכת כרטיס לקוח</Button>}{onClear && <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(null); onClear(); }}>ניתוק כרטיס לקוח</Button>}</div>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={() => setLoadRevision((old) => old + 1)}>נסו שוב</button></p>}
    <Input aria-label="חיפוש לקוח" placeholder="חיפוש לפי שם, ארגון, טלפון, אימייל או ח.פ." value={search} onFocus={() => setEngaged(true)} onChange={(event) => { setSearch(event.target.value); setEngaged(true); }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
    {engaged && <div aria-live="polite" className="space-y-1">
      {results.loading ? <p className="text-sm text-muted-foreground">מחפש לקוחות...</p> : results.error ? <p role="alert">{results.error} <button type="button" onClick={() => setRevision((old) => old + 1)}>נסו שוב</button></p> : results.rows.filter((row) => !row.archived_at).length === 0 ? <p className="text-sm text-muted-foreground">לא נמצאו לקוחות.</p> : results.rows.filter((row) => !row.archived_at).map((row) => <button key={row.id} type="button" className="block w-full text-right rounded-md border p-3 hover:bg-muted" onClick={() => { setSelected(row); setEngaged(false); setSearch(''); onSelect(row); }}>
        <span className="font-medium">{row.display_name}</span><span className="block text-sm text-muted-foreground">{[row.organization_name, row.phone, row.email].filter(Boolean).join(' · ')}</span>
      </button>)}
    </div>}
    {dialog && <CustomerFormDialog customer={dialog === 'edit' ? selected : null} initialValues={initialValues} onClose={() => setDialog(null)} onSaved={(row) => { setSelected(row); setDialog(null); setRevision((old) => old + 1); if (dialog === 'create') { setEngaged(false); onSelect(row); } }} />}
  </section>;
}
