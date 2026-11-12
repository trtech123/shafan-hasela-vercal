// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PhysicalPayment from './PhysicalPayment.jsx';
import { requestPhysicalPayment } from '@/payments/physical/client';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/payments/physical/client', () => ({ requestPhysicalPayment: vi.fn() }));

describe('physical POS checkout', () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(requestPhysicalPayment).mockReset(); });
  test('shows assigned CT20 and reserves once without a browser charge', async () => {
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20', label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') throw new Error('not_found');
      if (body.action === 'prepare') return { paymentId: '11111111-1111-4111-8111-111111111111',
        state: 'reserved', amountMinor: 2400, registerNumber: '004', saleId: null };
    });
    render(<MemoryRouter initialEntries={[{ pathname: '/payment/physical', state: { checkoutId: '22222222-2222-4222-8222-222222222222',
      cart: { lines: [{ kind: 'product', id: '33333333-3333-4333-8333-333333333333', qty: 1 }] } } }]}>
      <PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/Front CT20/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('שם מלא'), { target: { value: 'Test Customer' } });
    fireEvent.change(screen.getByLabelText('תעודת זהות'), { target: { value: '123456782' } });
    fireEvent.change(screen.getByLabelText('דואר אלקטרוני'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /שמור סל/ }));
    await waitFor(() => expect(requestPhysicalPayment).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'prepare', workstationCode: 'FRONT_DESK' })));
    expect(screen.getByText(/הבקשה נשמרה/)).toBeTruthy();
  });
});
