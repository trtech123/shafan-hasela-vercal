import { expect, test, vi } from 'vitest';
import { saveVoucher } from './voucher-save';

const request = { p_id: 'synthetic-voucher', p_data: { order_id: 'synthetic-order' } };
function client(read, write) {
  return {
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }) })),
    rpc: write,
  };
}

test('an existing order voucher is returned without another creation request', async () => {
  const write = vi.fn();
  const db = client(vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }), write);
  await expect(saveVoucher(db, request)).resolves.toEqual({ id: 'existing' });
  expect(write).not.toHaveBeenCalled();
});

test('an interrupted creation response is resolved by reading the unique order voucher', async () => {
  const read = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { id: 'created' }, error: null });
  const write = vi.fn().mockRejectedValue(new Error('connection lost'));
  await expect(saveVoucher(client(read, write), request)).resolves.toEqual({ id: 'created' });
  expect(write).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(2);
});

test('an unknown outcome never starts a second creation request', async () => {
  const read = vi.fn().mockResolvedValue({ data: null, error: null });
  const write = vi.fn().mockRejectedValue(new Error('connection lost'));
  await expect(saveVoucher(client(read, write), request)).rejects.toThrow('connection lost');
  expect(write).toHaveBeenCalledTimes(1);
});
