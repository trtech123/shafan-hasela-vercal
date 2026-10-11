// An identifier format check, not identity verification or authorization.
export function normalizeIsraeliId(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  if (!/^[0-9]{9}$/.test(digits) || digits === '000000000') return null;
  const sum = [...digits].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 + 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return sum % 10 === 0 ? digits : null;
}

export const SIGNER_ID_ERROR = 'יש להזין תעודת זהות תקינה בת 9 ספרות, כולל אפסים בתחילת המספר.';
