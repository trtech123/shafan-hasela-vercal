// Edge Function: create-user
// Admin-only user provisioning. Creates an auth user + sets their profiles role.
//
// Security model:
//   - verify_jwt = true (deploy WITHOUT --no-verify-jwt).
//   - The caller's JWT is verified, then we confirm the caller's profiles.role === 'admin'
//     using an anon client scoped to that JWT (RLS-safe, no privilege).
//   - Only AFTER the admin check do we use the service-role client to create the user.
//   - SUPABASE_SERVICE_ROLE_KEY is auto-injected by the platform and NEVER leaves the
//     function (never returned, never logged). The frontend never sees it.
//
// Request body:
//   { email, password, full_name, role }   role ∈ { admin, operations, cashier }
//
// Auto-injected secrets (no Dashboard config needed):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Roles the UI is allowed to assign. 'instructor' is intentionally excluded.
const ALLOWED_ROLES = ["admin", "operations", "cashier"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return json({ ok: false, error: "server not configured" }, 500);
    }

    // --- 1. Authenticate caller -------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "missing authorization" }, 401);
    }

    // Anon client scoped to the caller's JWT — subject to RLS, no privilege.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return json({ ok: false, error: "invalid session" }, 401);
    }

    // --- 2. Authorize caller as admin -------------------------------------
    const { data: callerProfile, error: profErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (profErr || !callerProfile || callerProfile.role !== "admin") {
      return json({ ok: false, error: "forbidden — admin only" }, 403);
    }

    // --- 3. Validate input ------------------------------------------------
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const email: string = (body?.email || "").trim();
    const password: string = body?.password || "";
    const full_name: string = (body?.full_name || "").trim();
    const role: string = body?.role || "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "כתובת אימייל לא תקינה" }, 400);
    }
    if (!password || password.length < 6) {
      return json({ ok: false, error: "סיסמה חייבת להכיל לפחות 6 תווים" }, 400);
    }
    if (!full_name) {
      return json({ ok: false, error: "שם מלא חסר" }, 400);
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ ok: false, error: "תפקיד לא חוקי" }, 400);
    }

    // --- 4. Create the user with the service role -------------------------
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message || "user creation failed";
      // Duplicate email and other auth errors surface here.
      return json({ ok: false, error: msg }, 400);
    }

    const newId = created.user.id;

    // The handle_new_user() trigger seeds a profiles row with role 'instructor'.
    // Overwrite role + full_name with the chosen values (upsert covers any race).
    const { error: upsertErr } = await adminClient
      .from("profiles")
      .upsert({ id: newId, email, full_name, role }, { onConflict: "id" });

    if (upsertErr) {
      return json(
        { ok: false, error: "user created but role assignment failed: " + upsertErr.message },
        500,
      );
    }

    return json({ ok: true, userId: newId });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
