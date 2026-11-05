// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import RecordManualPayperDocument from './RecordManualPayperDocument';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...args) => rpc(...args) } }));
afterEach(() => { cleanup(); rpc.mockReset(); });

test('records a verified Payper portal document against only its paid payment', async () => {
  rpc.mockResolvedValue({ data: true, error: null });
  render(<RecordManualPayperDocument paymentId="4a108cd6-d769-4d07-a193-0013b21a50ed" amount={3} onRecorded={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'רישום מסמך ידני מאומת' }));
  fireEvent.change(screen.getByLabelText('מספר מסמך Payper'), { target: { value: '595171' } });
  fireEvent.change(screen.getByLabelText('קישור למסמך Payper'), { target: { value: 'https://app.payper.co.il/public/invoice_show/595171' } });
  fireEvent.change(screen.getByLabelText('מועד הפקה'), { target: { value: '2026-11-05T12:00' } });
  fireEvent.change(screen.getByLabelText('אסמכתת אישור Payper'), { target: { value: 'support-12345' } });
  fireEvent.change(screen.getByLabelText('אסמכתת אישור רואה חשבון'), { target: { value: 'accountant-12345' } });
  fireEvent.click(screen.getByLabelText('בדקתי שהמסמך קיים ומתאים לתשלום המאומת'));
  fireEvent.click(screen.getByRole('button', { name: 'שמור התאמה' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('record_payper_manual_document', expect.objectContaining({
    p_payment_id: '4a108cd6-d769-4d07-a193-0013b21a50ed', p_document_number: '595171', p_amount: 3,
  })));
});

test('never submits without provider and accountant evidence', async () => {
  render(<RecordManualPayperDocument paymentId="4a108cd6-d769-4d07-a193-0013b21a50ed" amount={3} onRecorded={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'רישום מסמך ידני מאומת' }));
  expect(screen.getByRole('button', { name: 'שמור התאמה' })).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
});

test('rejects a Payper link whose document number differs from the recorded number', () => {
  render(<RecordManualPayperDocument paymentId="4a108cd6-d769-4d07-a193-0013b21a50ed" amount={3} />);
  fireEvent.click(screen.getByRole('button', { name: 'רישום מסמך ידני מאומת' }));
  fireEvent.change(screen.getByLabelText('מספר מסמך Payper'), { target: { value: '595171' } });
  fireEvent.change(screen.getByLabelText('קישור למסמך Payper'), { target: { value: 'https://app.payper.co.il/public/invoice_show/595172' } });
  fireEvent.change(screen.getByLabelText('מועד הפקה'), { target: { value: '2026-11-05T12:00' } });
  fireEvent.change(screen.getByLabelText('אסמכתת אישור Payper'), { target: { value: 'support-12345' } });
  fireEvent.change(screen.getByLabelText('אסמכתת אישור רואה חשבון'), { target: { value: 'accountant-12345' } });
  fireEvent.click(screen.getByLabelText('בדקתי שהמסמך קיים ומתאים לתשלום המאומת'));
  expect(screen.getByRole('button', { name: 'שמור התאמה' })).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
});
