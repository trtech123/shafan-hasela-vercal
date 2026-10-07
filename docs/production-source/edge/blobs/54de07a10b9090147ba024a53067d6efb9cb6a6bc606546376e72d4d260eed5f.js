const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const actions = new Set(["claim", "reply", "resume", "resolve", "close"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

export function createHandoffAdminHandler({ authorize, operations }) {
  return async function handoffAdminHandler(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);

    const authorization = await authorize(request);
    if (!authorization.ok) return json(authorization.body, authorization.status);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, code: "invalid_request" }, 400);
    }

    if (!actions.has(body?.action) || !uuidPattern.test(body?.handoffId ?? "")) {
      return json({ ok: false, code: "invalid_request" }, 400);
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (body.action === "reply" && (!message || message.length > 4096)) {
      return json({ ok: false, code: "invalid_request" }, 400);
    }

    try {
      const authorizedOperations = typeof operations.forUser === "function"
        ? operations.forUser(authorization.userClient)
        : operations;
      const result = body.action === "reply"
        ? await authorizedOperations.reply(body.handoffId, authorization.userId, message)
        : await authorizedOperations[body.action](body.handoffId, authorization.userId);
      if (result === false) return json({ ok: false, code: "state_conflict" }, 409);
      return json({ ok: true, action: body.action });
    } catch {
      return json({ ok: false, code: "operation_failed" }, 500);
    }
  };
}
