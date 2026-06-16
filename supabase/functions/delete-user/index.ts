// Edge Function: delete-user
// Admin-only hard-delete of a Supabase Auth user.
//
// Security model (same gate as create-user):
//   - verify_jwt = true (deploy WITHOUT --no-verify-jwt).
//   - Caller's JWT is verified, then we confirm caller's profiles.role === 'admin'
//     via an anon client scoped to that JWT (RLS-safe, no privilege).
//   - Self-delete is blocked server-side (cannot delete your own account).
//   - Only after both checks do we use the service-role client to delete the user.
//   - SUPABASE_SERVICE_ROLE_KEY is auto-injected, server-side only — never in frontend.
//
// Deleting auth.users cascades to public.profiles (FK ON DELETE CASCADE).
// All business FKs to profiles are ON DELETE SET NULL, so orders/sales/quotes/etc.
// are preserved (only their created_by/assigned_to is nulled). No business row is deleted.
//
// Request body: { userId }
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

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

    const userId: string = (body?.userId || "").trim();
    if (!userId) {
      return json({ ok: false, error: "missing userId" }, 400);
    }

    // --- 4. Block self-delete (server-side) -------------------------------
    if (userId === caller.id) {
      return json({ ok: false, error: "לא ניתן למחוק את המשתמש שלך" }, 400);
    }

    // --- 5. Delete with the service role ----------------------------------
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) {
      return json({ ok: false, error: delErr.message || "delete failed" }, 400);
    }
    // profiles row is removed by the auth.users → profiles cascade.

    return json({ ok: true, userId });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
