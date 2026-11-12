import { describe, expect, it, vi } from 'vitest';
import { deleteOrder, orderDeleteError } from './deleteOrder';

describe('deleteOrder', () => {
  it('requires a confirmed database response before reporting success', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'order-1', deleted: true }, error: null });
    await expect(deleteOrder({ rpc }, 'order-1')).resolves.toEqual({ id: 'order-1', deleted: true });
    expect(rpc).toHaveBeenCalledWith('delete_order', {
      p_order_id: 'order-1', p_confirm_no_external_commitments: true,
    });
  });

  it('does not treat a silent RLS denial or malformed reply as deletion', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(deleteOrder({ rpc }, 'order-1')).rejects.toThrow('order_delete_unconfirmed');
  });

  it('shows a useful reason when financial history blocks deletion', () => {
    expect(orderDeleteError({ message: 'order_delete_financial_dependency' }))
      .toContain('תשלום');
  });
});
