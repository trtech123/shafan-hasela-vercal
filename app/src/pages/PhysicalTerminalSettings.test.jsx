// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PhysicalTerminalSettings from './PhysicalTerminalSettings';

const state = vi.hoisted(() => ({ role: 'admin', rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: state.rpc, from: state.from } }));

const devices = [
  { registerNumber: '003', model: 'N86', label: 'N86 — 003', enabled: false, cashRegisterCode: null },
  ...['004', '005', '006'].map(number => ({ registerNumber: number, model: 'CT20', label: `CT20 — ${number}`, enabled: false, cashRegisterCode: null })),
];

function renderPage() {
  render(<MemoryRouter initialEntries={['/physical-terminal-settings']}><Routes>
    <Route path="/physical-terminal-settings" element={<PhysicalTerminalSettings />} />
    <Route path="/" element={<p>Home</p>} />
  </Routes></MemoryRouter>);
}

afterEach(() => { cleanup(); state.rpc.mockReset(); state.from.mockReset(); state.role = 'admin'; });

test('admin sees four fixed devices and can assign a workstation', async () => {
  state.rpc.mockImplementation(async name => name === 'list_physical_terminal_settings'
    ? { data: devices, error: null }
    : { data: { ...devices[0], label: 'Front desk', enabled: true, cashRegisterCode: 'FRONT' }, error: null });
  state.from.mockReturnValue({ select: () => ({ order: async () => ({ data: [{ code: 'FRONT', name: 'Front desk', active: true }], error: null }) }) });
  renderPage();
  expect(await screen.findByText('N86 — 003')).toBeInTheDocument();
  expect(screen.getByText('CT20 — 006')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('שם מסופון 003'), { target: { value: 'Front desk' } });
  fireEvent.change(screen.getByLabelText('עמדת קופה 003'), { target: { value: 'FRONT' } });
  fireEvent.click(screen.getByLabelText('מסופון 003 פעיל'));
  fireEvent.click(screen.getByRole('button', { name: 'שמירת מסופון 003' }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('save_physical_terminal_setting', {
    p_register_number: '003', p_label: 'Front desk', p_enabled: true, p_cash_register_code: 'FRONT',
  }));
});

test('non-admin cannot load settings', async () => {
  state.role = 'קופאי';
  renderPage();
  expect(await screen.findByText('Home')).toBeInTheDocument();
  expect(state.rpc).not.toHaveBeenCalled();
});

test('admin can add a named workstation before assigning a device', async () => {
  state.rpc.mockImplementation(async name => name === 'list_physical_terminal_settings'
    ? { data: devices, error: null }
    : { data: { code: 'BACK', name: 'Back desk', active: true }, error: null });
  state.from.mockReturnValue({ select: () => ({ order: async () => ({ data: [], error: null }) }) });
  renderPage();
  await screen.findByText('N86 — 003');
  fireEvent.change(screen.getByLabelText('קוד עמדה'), { target: { value: 'back' } });
  fireEvent.change(screen.getByLabelText('שם עמדה'), { target: { value: 'Back desk' } });
  fireEvent.click(screen.getByRole('button', { name: 'הוספת עמדה' }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('save_cash_register', {
    p_code: 'BACK', p_name: 'Back desk', p_active: true,
  }));
});
