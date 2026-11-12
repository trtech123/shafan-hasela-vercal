import { expect, test, vi } from 'vitest';
import { createPhysicalRegisterResolver } from '../../../server/pelecard-physical/device-settings.js';

test('resolves only the admin-assigned active device from the server database', async () => {
  const database = { query: vi.fn(async () => ({ rows: [{ register_number: '003' }] })) };
  const register = await createPhysicalRegisterResolver(database)('FRONT');
  expect(register).toBe('003');
  expect(typeof register).toBe('string');
  expect(database.query).toHaveBeenCalledWith(expect.stringContaining('physical_terminal_devices'), ['FRONT']);
  expect(database.query.mock.calls[0][0]).toContain('c.active');
});

test('unassigned workstation cannot select a physical device', async () => {
  const database = { query: vi.fn(async () => ({ rows: [] })) };
  expect(await createPhysicalRegisterResolver(database)('FRONT')).toBeNull();
  expect(await createPhysicalRegisterResolver(database)('003; DROP TABLE')).toBeNull();
  expect(database.query).toHaveBeenCalledTimes(1);
});
