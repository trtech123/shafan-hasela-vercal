/** Validate the caller with Supabase Auth, then read the caller's role under RLS. */
export async function authorizeRivhitUser(jwt, { url, anonKey, createClient, log = console.error }) {
  if (!url || !anonKey) {
    log('rivhit_readonly_auth_configuration_missing');
    return null;
  }
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let user;
  try {
    const result = await client.auth.getUser();
    if (result.error || !result.data?.user?.id) {
      log('rivhit_readonly_user_verification_failed', result.error?.code ?? 'no_user');
      return null;
    }
    user = result.data.user;
  } catch {
    log('rivhit_readonly_user_verification_unavailable');
    return null;
  }
  try {
    const profile = await client.from('profiles').select('role').eq('id', user.id).single();
    if (profile.error || !profile.data) {
      log('rivhit_readonly_profile_lookup_failed', profile.error?.code ?? 'no_profile');
      return null;
    }
    return String(profile.data.role);
  } catch {
    log('rivhit_readonly_profile_lookup_unavailable');
    return null;
  }
}
