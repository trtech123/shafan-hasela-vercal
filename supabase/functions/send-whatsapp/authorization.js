const ALLOWED_ROLES = new Set(["admin", "operations", "cashier"]);

function failure(status, code, error) {
  return { ok: false, status, body: { ok: false, code, error } };
}

export async function authorizeCaller({ request, supabaseUrl, anonKey, createClientImpl }) {
  if (!supabaseUrl || !anonKey) {
    return failure(500, "server_not_configured", "WhatsApp service is not configured");
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return failure(401, "unauthorized", "Authentication required");
  }

  try {
    const client = createClientImpl(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } = {}, error: userError } = await client.auth.getUser();
    if (userError || !user) {
      return failure(401, "unauthorized", "Authentication required");
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) {
      return failure(503, "authorization_failed", "Unable to authorize the request");
    }
    if (!profile || !ALLOWED_ROLES.has(profile.role)) {
      return failure(403, "forbidden", "You are not allowed to send WhatsApp messages");
    }
    return { ok: true, role: profile.role };
  } catch {
    return failure(503, "authorization_failed", "Unable to authorize the request");
  }
}
