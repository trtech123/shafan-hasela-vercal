const ALLOWED_ROLES = new Set(["admin", "operations"]);

function failure(status, code) {
  return { ok: false, status, body: { ok: false, code } };
}

export async function authorizeHandoffStaff({ request, supabaseUrl, anonKey, createClientImpl }) {
  if (!supabaseUrl || !anonKey) return failure(500, "server_not_configured");
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/iu.test(authorization)) return failure(401, "unauthorized");

  try {
    const client = createClientImpl(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } = {}, error: userError } = await client.auth.getUser();
    if (userError || !user) return failure(401, "unauthorized");

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) return failure(503, "authorization_failed");
    if (!profile || !ALLOWED_ROLES.has(profile.role)) return failure(403, "forbidden");
    return { ok: true, userId: user.id, role: profile.role, userClient: client };
  } catch {
    return failure(503, "authorization_failed");
  }
}
