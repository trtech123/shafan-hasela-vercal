import { describe, expect, test, vi } from 'vitest';
import { listPhysicalTerminalSettings, savePhysicalTerminalSetting } from './settings.js';

const rows = [
  { registerNumber: '003', model: 'N86', label: 'Front', enabled: false, cashRegisterCode: null },
  { registerNumber: '004', model: 'CT20', label: 'Counter 1', enabled: false, cashRegisterCode: 'COUNTER_1' },
  { registerNumber: '005', model: 'CT20', label: 'Counter 2', enabled: false, cashRegisterCode: null },
  { registerNumber: '006', model: 'CT20', label: 'Counter 3', enabled: false, cashRegisterCode: null },
];

test('loads exactly four fixed physical devices through an admin RPC', async () => {
  const client = { rpc: vi.fn(async () => ({ data: rows, error: null })) };
  expect(await listPhysicalTerminalSettings(client)).toEqual(rows);
  expect(client.rpc).toHaveBeenCalledWith('list_physical_terminal_settings');
});

describe('saving physical device settings', () => {
  test('sends only editable fields to the admin RPC', async () => {
    const client = { rpc: vi.fn(async () => ({ data: rows[1], error: null })) };
    await savePhysicalTerminalSetting(client, {
      registerNumber: '004', model: 'N86', merchantTerminal: 'other', label: ' Counter 1 ',
      enabled: true, cashRegisterCode: 'COUNTER_1', password: 'never-send',
    });
    expect(client.rpc).toHaveBeenCalledWith('save_physical_terminal_setting', {
      p_register_number: '004', p_label: 'Counter 1', p_enabled: true,
      p_cash_register_code: 'COUNTER_1',
    });
  });
  test.each(['002', '007', 'abc'])('rejects unknown device %s', async registerNumber => {
    const client = { rpc: vi.fn() };
    await expect(savePhysicalTerminalSetting(client, { registerNumber, label: 'Desk', enabled: false })).rejects.toThrow('physical_setting_invalid');
    expect(client.rpc).not.toHaveBeenCalled();
  });
  test('rejects duplicate or malformed server rows', async () => {
    const client = { rpc: vi.fn(async () => ({ data: [rows[0], rows[0], rows[2], rows[3]], error: null })) };
    await expect(listPhysicalTerminalSettings(client)).rejects.toThrow('physical_settings_unavailable');
  });
});
