// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ClubAttendance from './ClubAttendance';
import { israelDate, shiftDate, validAttendanceRange } from '@/lib/clubAttendance';

const state = vi.hoisted(() => ({ role: 'admin', from: vi.fn(), rpc: vi.fn(), rows: [], sessions: [], clubs: [] }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => state.from(...args), rpc: (...args) => state.rpc(...args) } }));
function query(data) {
  const b = { select: () => b, eq: () => b, gte: () => b, lte: () => b, order: () => b,
    then: (resolve) => Promise.resolve({ data, error: null }).then(resolve) };
  return b;
}
beforeEach(() => {
  state.role = 'admin'; state.rows = []; state.sessions = [];
  state.clubs = [{ id: 'c', name: 'חוג בדיקה', status: 'active' }];
  state.from.mockReset().mockImplementation(table => query(table === 'clubs' ? state.clubs : table === 'club_sessions' ? state.sessions : []));
  state.rpc.mockReset().mockImplementation(async name => ({ data: name === 'get_club_attendance_history' ? state.rows : 0, error: null }));
});
afterEach(cleanup);
test('Israel calendar dates and bounded ranges survive DST and UTC midnight', () => {
  expect(israelDate(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
  expect(shiftDate('2026-10-25', 1)).toBe('2026-10-26');
  expect(validAttendanceRange('2026-02-30', '2026-03-01')).toBe(false);
  expect(validAttendanceRange('2026-01-01', '2026-03-03')).toBe(true);
  expect(validAttendanceRange('2026-01-01', '2026-03-04')).toBe(false);
});
test.each(['מדריך', 'קופאי', 'אחמ"ש', undefined])('non-admin %s sees no operational data', role => {
  state.role = role; render(<ClubAttendance />);
  expect(screen.getByRole('alert')).toHaveTextContent('אין הרשאה');
  expect(state.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
test('opening and refreshing are read-only; empty sessions explain explicit creation', async () => {
  render(<ClubAttendance />);
  expect(await screen.findByText('אין מפגשים בטווח שנבחר')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'רענון מפגשים' }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  expect(state.rpc.mock.calls.every(([name]) => name === 'get_club_attendance_history')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'יצירת מפגשים מהמערכת השבועית' }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('materialize_club_sessions', expect.objectContaining({ p_club_id: 'c' })));
});
test('empty club list and query errors have explicit states', async () => {
  state.clubs = []; render(<ClubAttendance />);
  expect(await screen.findByText('אין חוגים להצגה')).toBeInTheDocument();
  cleanup(); state.from.mockImplementation(() => Promise.reject(new Error('network')));
  render(<ClubAttendance />); expect(await screen.findByRole('alert')).toHaveTextContent('טעינת הנתונים נכשלה');
});
test('marks carry version and notes, double click does not issue concurrent writes', async () => {
  state.sessions = [{ id: 's', club_id: 'c', session_date: israelDate(), start_time: '16:00', end_time: '17:00', status: 'scheduled', version: 0 }];
  state.rows = [{ session_id: 's', membership_id: 'm', participant_id: 'p', participant_name: 'משתתף בדיקה', version: 0 }];
  render(<ClubAttendance />);
  fireEvent.click(await screen.findByRole('button', { name: /פתיחת מפגש/ }));
  fireEvent.change(screen.getByLabelText('הערה עבור משתתף בדיקה'), { target: { value: 'תיקון' } });
  let release = (_value) => {};
  const pending = new Promise(resolve => { release = resolve; });
  state.rpc.mockImplementation(name => name === 'mark_club_attendance' ? pending : Promise.resolve({ data: state.rows, error: null }));
  const present = screen.getByRole('button', { name: 'נוכח/ת' });
  fireEvent.click(present); fireEvent.click(present);
  expect(state.rpc.mock.calls.filter(([name]) => name === 'mark_club_attendance')).toHaveLength(1);
  expect(state.rpc).toHaveBeenCalledWith('mark_club_attendance', { p_session_id: 's', p_membership_id: 'm', p_status: 'present', p_expected_version: 0, p_notes: 'תיקון' });
  release({ data: null, error: { message: 'attendance_conflict' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('עודכנו במקביל');
});
test('cancelled session keeps history but disables roster and attendance writes', async () => {
  state.sessions = [{ id: 's', session_date: israelDate(), start_time: '16:00', end_time: '17:00', status: 'cancelled', version: 1 }];
  state.rows = [{ session_id: 's', membership_id: 'm', participant_id: 'p', participant_name: 'משתתף בדיקה', status: 'absent', version: 2 }];
  render(<ClubAttendance />); fireEvent.click(await screen.findByRole('button', { name: /פתיחת מפגש/ }));
  expect(screen.getByRole('button', { name: 'פתיחה / עדכון רשימת משתתפים' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'נוכח/ת' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'נעדר/ת' })).toHaveAttribute('aria-pressed', 'true');
});
