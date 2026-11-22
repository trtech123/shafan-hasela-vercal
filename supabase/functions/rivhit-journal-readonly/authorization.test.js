import { describe, expect, test, vi } from 'vitest';
import { authorizeRivhitUser } from './authorization.js';

function setup({ user = { id: 'synthetic-admin' }, role = 'admin', authError = null, profileError = null } = {}) {
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: authError });
  const single = vi.fn().mockResolvedValue({ data: role ? { role } : null, error: profileError });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const createClient = vi.fn().mockReturnValue({ auth: { getUser }, from });
  const log = vi.fn();
  return { getUser, single, eq, from, createClient, log };
}

describe('Rivhit read-only user authorization', () => {
  test('verifies a session and reads its role under the caller JWT', async () => {
    const deps = setup();
    expect(await authorizeRivhitUser('synthetic-jwt', { url: 'https://example.invalid', anonKey: 'synthetic-anon', ...deps })).toBe('admin');
    expect(deps.createClient).toHaveBeenCalledWith('https://example.invalid', 'synthetic-anon', {
      global: { headers: { Authorization: 'Bearer synthetic-jwt' } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(deps.getUser).toHaveBeenCalledWith();
    expect(deps.from).toHaveBeenCalledWith('profiles');
    expect(deps.eq).toHaveBeenCalledWith('id', 'synthetic-admin');
  });

  test('rejects invalid sessions before profile access without logging a JWT', async () => {
    const deps = setup({ user: null, authError: { code: 'invalid_token' } });
    expect(await authorizeRivhitUser('synthetic-jwt', { url: 'https://example.invalid', anonKey: 'synthetic-anon', ...deps })).toBeNull();
    expect(deps.from).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain('synthetic-jwt');
  });

  test('returns the actual non-admin role for handler rejection', async () => {
    const deps = setup({ role: 'cashier' });
    expect(await authorizeRivhitUser('synthetic-jwt', { url: 'https://example.invalid', anonKey: 'synthetic-anon', ...deps })).toBe('cashier');
  });

  test('rejects missing server configuration and profile lookup failures', async () => {
    const missing = setup();
    expect(await authorizeRivhitUser('synthetic-jwt', { url: '', anonKey: '', ...missing })).toBeNull();
    expect(missing.createClient).not.toHaveBeenCalled();
    const lookup = setup({ profileError: { code: 'PGRST116' }, role: null });
    expect(await authorizeRivhitUser('synthetic-jwt', { url: 'https://example.invalid', anonKey: 'synthetic-anon', ...lookup })).toBeNull();
    expect(lookup.log).toHaveBeenCalledWith('rivhit_readonly_profile_lookup_failed', 'PGRST116');
  });
});
