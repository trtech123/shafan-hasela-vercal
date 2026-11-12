const workstationCode = /^[A-Z][A-Z0-9_]{0,39}$/;
const physicalRegister = /^(003|004|005|006)$/;

/** Reads only an active admin-assigned device; never accepts a register from the browser. */
export function createPhysicalRegisterResolver(database) {
  return async cashRegisterCode => {
    if (typeof cashRegisterCode !== 'string' || !workstationCode.test(cashRegisterCode)) return null;
    const { rows } = await database.query(`
      SELECT d.register_number
      FROM public.physical_terminal_devices d
      JOIN public.cash_registers c ON c.code=d.cash_register_code
      WHERE d.cash_register_code=$1 AND d.enabled AND c.active
    `, [cashRegisterCode]);
    if (rows?.length !== 1 || !physicalRegister.test(rows[0]?.register_number)) return null;
    return rows[0].register_number;
  };
}
