import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { loadOrderFinancialBadges } from './orderFinancialBadges';

export function useOrderFinancialBadges(orders) {
  const [rows, setRows] = useState({});
  useEffect(() => {
    let active = true;
    setRows({});
    loadOrderFinancialBadges(supabase, orders.map(order => order.id).filter(Boolean))
      .then(data => { if (active) setRows(data); })
      .catch(() => { if (active) setRows({}); });
    return () => { active = false; };
  }, [orders]);
  return rows;
}
