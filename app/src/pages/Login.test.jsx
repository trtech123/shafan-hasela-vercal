// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import Login from './Login';

const auth = vi.hoisted(() => ({ authenticated: false }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: auth.authenticated }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { auth: { signInWithPassword: vi.fn() } } }));

beforeEach(() => { auth.authenticated = false; });

test('an authenticated user returns to the app even if profile loading finished after the first redirect', async () => {
  const view = () => <MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<h1>יישום פעיל</h1>} />
  </Routes></MemoryRouter>;
  const { rerender } = render(view());
  expect(screen.getByRole('heading', { name: 'כניסה למערכת' })).toBeInTheDocument();
  auth.authenticated = true;
  rerender(view());
  expect(await screen.findByRole('heading', { name: 'יישום פעיל' })).toBeInTheDocument();
});
