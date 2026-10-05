import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { customerErrorMessage } from '@/lib/customers';

export default function useCustomerSearch(search, { enabled = true, includeArchived = false, revision = 0 } = {}) {
  const [state, setState] = useState({ rows: [], loading: false, error: '' });
  useEffect(() => {
    if (!enabled) { setState({ rows: [], loading: false, error: '' }); return; }
    let active = true;
    setState({ rows: [], loading: true, error: '' });
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('search_customers', { p_search: search.trim(), p_include_archived: includeArchived });
        if (error) throw error;
        if (active) setState({ rows: data || [], loading: false, error: '' });
      } catch (error) {
        if (active) setState({ rows: [], loading: false, error: customerErrorMessage(error) });
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [search, enabled, includeArchived, revision]);
  return state;
}
