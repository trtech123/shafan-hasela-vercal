import { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { canManageCustomers, canArchiveCustomers, customerErrorMessage } from '@/lib/customers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CustomerFormDialog from '@/components/customers/CustomerFormDialog';
import useCustomerSearch from '@/components/customers/useCustomerSearch';

export default function Customers() {
  const { user } = useAuth();
  const allowed = canManageCustomers(user?.role);
  const archiver = canArchiveCustomers(user?.role);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(undefined);
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const results = useCustomerSearch(search, { enabled: allowed, includeArchived: archiver && includeArchived, revision });
  if (!allowed) return <p role="alert">אין הרשאה לצפות בלקוחות.</p>;
  const archive = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: archiveError } = await supabase.rpc('archive_customer', { p_id: archiving.id, p_expected_version: archiving.version });
      if (archiveError) throw archiveError;
      const archived = Array.isArray(data) ? data[0] : data;
      if (!archived?.id) throw new Error('customer_archive_empty');
      setArchiving(null); setRevision((old) => old + 1);
    } catch (archiveError) { setError(customerErrorMessage(archiveError)); }
    finally { setBusy(false); }
  };
  return <div dir="rtl" className="space-y-6 text-card-foreground">
    <div className="flex justify-between items-start gap-4"><div><h1 className="text-2xl font-bold">לקוחות</h1><p className="text-muted-foreground mt-1">פרטי קשר וחיוב לשימוש בהזמנות ובהצעות מחיר</p></div><Button onClick={() => setEditing(null)}>לקוח חדש</Button></div>
    <Input aria-label="חיפוש לקוחות" placeholder="שם, ארגון, טלפון, אימייל או ח.פ." value={search} onChange={(event) => setSearch(event.target.value)} />
    {archiver && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />הצגת לקוחות בארכיון</label>}
    {(error || results.error) && <p role="alert" className="text-red-700">{error || results.error} <Button variant="outline" onClick={() => { setError(''); setRevision((old) => old + 1); }}>נסו שוב</Button></p>}
    {archiving && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3"><p>להעביר את {archiving.display_name} לארכיון? הקישור להזמנות קיימות יישמר.</p><div className="flex gap-2"><Button disabled={busy} onClick={archive}>אישור העברה לארכיון</Button><Button variant="outline" disabled={busy} onClick={() => setArchiving(null)}>ביטול</Button></div></div>}
    {results.loading ? <p role="status">טוען לקוחות...</p> : !results.error && results.rows.length === 0 ? <p className="rounded-lg border p-8 text-center text-muted-foreground">לא נמצאו לקוחות. אפשר לנסות חיפוש אחר או ליצור לקוח חדש.</p> : <div className="grid gap-3">{results.rows.map((row) => <article key={row.id} className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row justify-between gap-3">
      <div><h2 className="font-semibold">{row.display_name}{row.archived_at && <span className="mr-2 text-sm text-muted-foreground">בארכיון</span>}</h2><p className="text-sm text-muted-foreground break-words">{[row.organization_name, row.contact_name, row.phone, row.email].filter(Boolean).join(' · ')}</p>{row.billing_company_id && <p className="text-sm">ח.פ / ע.מ: {row.billing_company_id}</p>}</div>
      {!row.archived_at && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditing(row)}>עריכת כרטיס לקוח</Button>{archiver && <Button variant="ghost" onClick={() => { setError(''); setArchiving(row); }}>העברה לארכיון</Button>}</div>}
    </article>)}</div>}
    {editing !== undefined && <CustomerFormDialog customer={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRevision((old) => old + 1); }} />}
  </div>;
}
