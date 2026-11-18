import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { loadOrderFinancialBadges } from './orderFinancialBadges';

export function useOrderFinancialBadges(orders) {
  const ids = useMemo(() => orders.map(order => order.id).filter(Boolean).sort().join(','), [orders]);
  const [rows, setRows] = useState({});
  useEffect(() => {
    let active = true;
    setRows({});
    loadOrderFinancialBadges(supabase, ids ? ids.split(',') : [])
      .then(data => { if (active) setRows(data); })
      .catch(() => { if (active) setRows({}); });
    return () => { active = false; };
  }, [ids]);
  return rows;
}
