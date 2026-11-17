// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PhysicalPayment from './PhysicalPayment.jsx';
import { requestPhysicalPayment } from '@/payments/physical/client';
import { supabase } from '@/api/supabaseClient';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/payments/physical/client', () => ({ requestPhysicalPayment: vi.fn() }));

describe('physical POS checkout', () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(requestPhysicalPayment).mockReset();
    vi.mocked(supabase.functions.invoke).mockReset(); auth.role = 'admin'; });
  afterEach(() => cleanup());
  test('operations role can inspect an existing physical attempt without starting another', async () => {
    auth.role = 'operations';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({
      requestKey: '22222222-2222-4222-8222-222222222222', orderId: null, mode: 'direct' }));
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) =>
      body.action === 'devices' ? [] : { paymentId: '11111111-1111-4111-8111-111111111111',
        state: 'uncertain', route: 'direct', amountMinor: 1500, registerNumber: '004' });
    render(<MemoryRouter initialEntries={['/payment/physical']}><PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/מצב התשלום טרם אומת/)).toBeTruthy();
    expect(requestPhysicalPayment).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'prepare' }));
  });
  test('cashier opens the hosted PINPAD page after reserving the frozen intent', async () => {
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({
      requestKey: '22222222-2222-4222-8222-222222222222', orderId: null }));
    const base = { paymentId: '11111111-1111-4111-8111-111111111111',
      state: 'reserved', route: 'direct', hostedAvailable: true,
      amountMinor: 2400, registerNumber: '004', saleId: null };
    const url = 'https://gateway21.pelecard.biz/PaymentGW?transactionId=33333333-3333-4333-8333-333333333333';
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20',
        label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') return base;
      if (body.action === 'openHosted') return { ...base, state: 'pending', route: 'hosted',
        redirectUrl: url };
    });
    render(<MemoryRouter initialEntries={['/payment/physical']}><PhysicalPayment /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /פתחו דף תשלום למסופון/ }));
    await waitFor(() => expect(requestPhysicalPayment).toHaveBeenCalledWith(expect.anything(),
      { action: 'openHosted', requestKey: '22222222-2222-4222-8222-222222222222' }));
    expect((await screen.findByRole('link', { name: /המשך לדף פלאקארד/ })).getAttribute('href')).toBe(url);
  });
  test('queued direct J4 intent never offers the hosted page on the status screen', async () => {
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({
      requestKey: '22222222-2222-4222-8222-222222222222', orderId: null, mode: 'direct' }));
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) =>
      body.action === 'devices' ? [{ registerNumber: '004', model: 'CT20',
        label: 'Front CT20', workstationCode: 'FRONT_DESK' }] : {
        paymentId: '11111111-1111-4111-8111-111111111111', state: 'reserved',
        route: 'direct', hostedAvailable: true, amountMinor: 1500,
        registerNumber: '004', saleId: null });
    render(<MemoryRouter initialEntries={['/payment/physical']}><PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/ממתינים לשליחה למסופון/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /פתחו דף תשלום למסופון/ })).toBeNull();
    expect(requestPhysicalPayment).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'openHosted' }));
  });
  test('a paid physical transaction with missing invoice stays recoverable without a new charge', async () => {
    const requestKey = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({ requestKey, orderId: null }));
    const paid = { paymentId: '11111111-1111-4111-8111-111111111111', state: 'succeeded',
      route: 'hosted', amountMinor: 2400, registerNumber: '004',
      saleId: '33333333-3333-4333-8333-333333333333', documentState: 'source_blocked' };
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) =>
      body.action === 'devices' ? [] : paid);
    render(<MemoryRouter initialEntries={['/payment/physical']}><PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/פרטי החשבונית דורשים התאמה/)).toBeTruthy();
    expect(localStorage.getItem('pelecard.physicalPending.v1')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /בדיקה חוזרת של החשבונית/ }));
    await waitFor(() => expect(requestPhysicalPayment).toHaveBeenCalledWith(expect.anything(),
      { action: 'verify', requestKey }));
  });
  test('direct standalone visits return to the cashier without preparing a charge', async () => {
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20', label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') throw new Error('not_found');
      if (body.action === 'prepare') return { paymentId: '11111111-1111-4111-8111-111111111111',
        state: 'reserved', amountMinor: 2400, registerNumber: '004', saleId: null };
    });
    render(<MemoryRouter initialEntries={[{ pathname: '/payment/physical', state: { checkoutId: '22222222-2222-4222-8222-222222222222',
      cart: { lines: [{ kind: 'product', id: '33333333-3333-4333-8333-333333333333', qty: 1 }] } } }]}>
      <PhysicalPayment /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /שמור סל/ })).toBeNull();
    expect(requestPhysicalPayment).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'prepare' }));
  });
  test('direct order visits return to the cashier without preparing a payment', async () => {
    const orderId = '44444444-4444-4444-8444-444444444444';
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: {
      orderId, orderNumber: 'ORD-42', clientName: 'Group customer', organization: 'School',
      totalMinor: 10000, paidMinor: 3000, balanceMinor: 7000, unresolvedPayment: false,
      billing: { name: 'School', identity: '123456782', email: 'school@example.com' },
      payments: [], documents: [],
    }, error: null });
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20',
        label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') throw new Error('not_found');
      if (body.action === 'prepareOrder') return { paymentId: '11111111-1111-4111-8111-111111111111',
        orderId, state: 'reserved', amountMinor: 2500, registerNumber: '004', saleId: null };
    });
    render(<MemoryRouter initialEntries={[`/payment/physical?orderId=${orderId}`]}>
      <PhysicalPayment /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /שמור.*הזמנה/ })).toBeNull();
    expect(requestPhysicalPayment).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'prepareOrder' }));
  });
  test('recovers an uncertain order payment after browser closure without preparing another', async () => {
    const orderId = '44444444-4444-4444-8444-444444444444';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({
      requestKey: '22222222-2222-4222-8222-222222222222', orderId }));
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: {
      orderId, orderNumber: 'ORD-42', clientName: 'Group customer', organization: 'School',
      totalMinor: 10000, paidMinor: 3000, balanceMinor: 7000, unresolvedPayment: true,
      billing: {}, payments: [], documents: [],
    }, error: null });
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20',
        label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') return { paymentId: '11111111-1111-4111-8111-111111111111',
        orderId, state: 'uncertain', amountMinor: 2500, registerNumber: '004', saleId: null };
    });
    render(<MemoryRouter initialEntries={['/payment/physical']}><PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/ORD-42/)).toBeTruthy();
    expect(screen.getByText(/קיים תשלום שמצבו אינו ודאי/)).toBeTruthy();
    expect(requestPhysicalPayment).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'prepareOrder' }));
  });
  test('recovers a pending standalone charge before opening a different order', async () => {
    const orderId = '44444444-4444-4444-8444-444444444444';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({
      requestKey: '22222222-2222-4222-8222-222222222222', cart: '{}', orderId: null }));
    vi.mocked(requestPhysicalPayment).mockImplementation(async (_client, body) => {
      if (body.action === 'devices') return [{ registerNumber: '004', model: 'CT20',
        label: 'Front CT20', workstationCode: 'FRONT_DESK' }];
      if (body.action === 'status') return { paymentId: '11111111-1111-4111-8111-111111111111',
        orderId: null, state: 'reserved', amountMinor: 2400, registerNumber: '004', saleId: null };
    });
    render(<MemoryRouter initialEntries={[`/payment/physical?orderId=${orderId}`]}>
      <PhysicalPayment /></MemoryRouter>);
    expect(await screen.findByText(/24\.00/)).toBeTruthy();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
