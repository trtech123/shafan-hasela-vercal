// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RevenueReport from './RevenueReport';
import { supabase } from '@/api/supabaseClient';

vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: { rows: [] }, error: null })) },
}));

describe('RevenueReport filters', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers five business types and sends the selected site and historical type to the read-only RPC', async () => {
    render(<RevenueReport />);
    const type = screen.getByLabelText('סוג לקוח');
    expect([...type.options].map(option => option.textContent)).toEqual([
      'כל הסוגים', 'חינוכית', 'גפ״ן', 'סוכן/מפיק', 'חברה', 'לקוח פרטי', 'ללא סיווג',
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'הצג דוח' }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('אתר פעילות'), { target: { value: 'עכו' } });
    fireEvent.change(type, { target: { value: 'חברה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הצג דוח' }));
    await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith('get_revenue_report',
      expect.objectContaining({ p_site: 'עכו', p_customer_type: 'חברה' })));
  });
});
