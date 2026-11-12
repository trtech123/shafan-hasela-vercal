const DEVICE_MODELS = Object.freeze({ '003': 'N86', '004': 'CT20', '005': 'CT20', '006': 'CT20' });
const DEVICE_NUMBERS = Object.keys(DEVICE_MODELS);
const WORKSTATION_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

function validRow(row) {
  return row && DEVICE_MODELS[row.registerNumber] === row.model &&
    typeof row.label === 'string' && row.label.trim() === row.label && row.label.length >= 1 && row.label.length <= 80 &&
    typeof row.enabled === 'boolean' &&
    (row.cashRegisterCode === null || WORKSTATION_CODE.test(row.cashRegisterCode));
}

export async function listPhysicalTerminalSettings(client) {
  const { data, error } = await client.rpc('list_physical_terminal_settings');
  if (error || !Array.isArray(data) || data.length !== 4 ||
    new Set(data.map(row => row?.registerNumber)).size !== 4 ||
    data.some(row => !validRow(row)) ||
    DEVICE_NUMBERS.some(number => !data.some(row => row.registerNumber === number)))
    throw new Error('physical_settings_unavailable');
  return data;
}

export async function savePhysicalTerminalSetting(client, setting) {
  const label = setting?.label?.trim();
  const code = setting?.cashRegisterCode || null;
  if (!DEVICE_NUMBERS.includes(setting?.registerNumber) || typeof label !== 'string' ||
    label.length < 1 || label.length > 80 || typeof setting?.enabled !== 'boolean' ||
    (code !== null && !WORKSTATION_CODE.test(code)))
    throw new Error('physical_setting_invalid');
  const { data, error } = await client.rpc('save_physical_terminal_setting', {
    p_register_number: setting.registerNumber,
    p_label: label,
    p_enabled: setting.enabled,
    p_cash_register_code: code,
  });
  if (error || !validRow(data) || data.registerNumber !== setting.registerNumber)
    throw new Error('physical_setting_save_failed');
  return data;
}
