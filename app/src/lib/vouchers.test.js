import { expect, test } from 'vitest';
import { voucherError } from './vouchers';

test('missing organization company ID explains the required correction without suggesting another issuance', () => {
  expect(voucherError({ message: 'billing_company_id_required' })).toMatch(/ח\.פ|ע\.מ/);
  expect(voucherError({ message: 'billing_company_id_required' })).toMatch(/כרטיס הלקוח/);
});

test('an uncertain voucher outcome keeps its reconciliation instruction', () => {
  expect(voucherError(new Error('connection lost'))).toMatch(/לא תישלח בקשת יצירה נוספת/);
});

test('known register and permission failures are not described as uncertain issuance', () => {
  expect(voucherError({ message: 'active_register_required' })).toMatch(/קופה פעילה/);
  expect(voucherError({ message: 'voucher_access_denied' })).toMatch(/אין הרשאה/);
});
