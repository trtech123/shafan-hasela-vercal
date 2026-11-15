import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { paymentCorsHeaders, paymentJson, PaymentHttpError } from
  "../pelecard-order-payment/_deployed_shared/payment-http.ts";
import { buildNoncardPayperRequest, dispatchNoncardPayper, noncardCollectionAllowed, type NoncardSource } from
  "../_shared/payper/noncard.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("configuration_required");
  return value;
};

Deno.serve(async request => {
  let cors: HeadersInit = {};
  try {
    cors = paymentCorsHeaders(request, required("PAYMENTS_APP_ORIGINS").split(",").map(x => x.trim()));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") throw new PaymentHttpError(405, "method_not_allowed");
    const token = request.headers.get("Authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token) throw new PaymentHttpError(401, "missing_authorization");
    const raw = await request.text();
    if (raw.length > 16_384) throw new PaymentHttpError(413, "body_too_large");
    const body = JSON.parse(raw) as Record<string, unknown>;
    const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: identity, error: authError } = await client.auth.getUser(token);
    if (authError || !identity.user) throw new PaymentHttpError(401, "invalid_session");
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("role").eq("id", identity.user.id).single();
    if (profileError || !["admin", "cashier", "קופאי"].includes(String(profile?.role)))
      throw new PaymentHttpError(403, "forbidden");
    const actorId = identity.user.id;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const result = await client.rpc(name, args);
      if (result.error) throw new PaymentHttpError(409, "collection_review_required");
      return result.data;
    };
    if (body.action === "status") {
      if (typeof body.orderId !== "string" || !uuid.test(body.orderId))
        throw new PaymentHttpError(400, "order_id_invalid");
      const view = await rpc("get_payper_order_collection", {
        p_actor_id: actorId, p_order_id: body.orderId,
      });
      const billingDefaults = await rpc("get_payper_billing_defaults", {
        p_order_id: body.orderId, p_actor_id: actorId,
      });
      const issues = await rpc("digital_order_payment_issues", {
        p_order_id: body.orderId, p_actor_id: actorId, p_billing: billingDefaults,
      }) as string[];
      const { data: order, error: orderError } = await client.from("orders")
        .select("vat_applicable,customer_snapshot_id").eq("id", body.orderId).single();
      if (orderError || !order) throw new PaymentHttpError(409, "order_collection_review_required");
      return paymentJson({ ...view, billing: billingDefaults,
        billingIssues: [...issues.filter(issue => issue !== "digital_partial_unsupported"),
          ...(order.vat_applicable === false ? ["cash_vat_unsupported"] : [])],
        customerSnapshotId: order.customer_snapshot_id,
        collectionEnabled: {
        cash: noncardCollectionAllowed("cash", actorId, name => Deno.env.get(name)),
        check: noncardCollectionAllowed("check", actorId, name => Deno.env.get(name)),
      } }, 200, cors);
    }
    if (body.action !== "collect" || typeof body.requestKey !== "string" || !uuid.test(body.requestKey))
      throw new PaymentHttpError(400, "request_invalid");
    if (body.method !== "check" && body.method !== "cash")
      throw new PaymentHttpError(400, "method_invalid");
    if (!noncardCollectionAllowed(body.method, actorId, name => Deno.env.get(name)))
      throw new PaymentHttpError(503, "collection_disabled");
    let saved: { paymentId: string; saleId: string; receiptNumber: string; created: boolean;
      orderId?: string; balanceMinor?: number };
    if (typeof body.orderId === "string" && uuid.test(body.orderId)) {
      saved = await rpc("record_payper_order_collection", {
        p_actor_id: actorId, p_request_key: body.requestKey, p_order_id: body.orderId,
        p_method: body.method, p_amount_minor: body.amountMinor,
        p_check: body.method === "check" ? body.check : null,
        p_billing: body.billing, p_document_type: body.documentType,
        p_reference_document_id: body.referenceDocumentId ?? null,
      }) as typeof saved;
    } else if (body.orderId == null) {
      saved = await rpc("record_payper_noncard_sale", {
        p_actor_id: actorId, p_request_key: body.requestKey, p_method: body.method,
        p_lines: body.lines,
        p_discount: body.discount ?? null, p_check: body.check, p_billing: body.billing,
        p_document_type: body.documentType, p_reference_document_id: body.referenceDocumentId ?? null,
        p_expected_minor: body.amountMinor,
      }) as typeof saved;
    } else throw new PaymentHttpError(400, "order_id_required");
    if (!uuid.test(saved.paymentId) || !uuid.test(saved.saleId))
      throw new PaymentHttpError(502, "saved_payment_unavailable");
    const { data: ledger, error: ledgerError } = await client.from("payper_document_ledger")
      .select("state,document_number,document_url,reconciliation_code,source_facts")
      .eq("payment_id", saved.paymentId).single();
    if (ledgerError || !ledger) throw new PaymentHttpError(502, "accounting_state_unavailable");
    const view = () => ({ saleId: saved.saleId, paymentId: saved.paymentId,
      receiptNumber: saved.receiptNumber, orderId: saved.orderId ?? null,
      balanceMinor: saved.balanceMinor ?? null, accounting: {
        state: ledger.state, documentNumber: ledger.document_number,
        documentUrl: ledger.document_url, code: ledger.reconciliation_code,
      } });
    const dispatchFlag = body.method === "cash"
      ? "PAYPER_CASH_DISPATCH_ENABLED" : "PAYPER_CHECK_DISPATCH_ENABLED";
    if (!saved.created || ledger.state !== "source_frozen" ||
      Deno.env.get(dispatchFlag) !== "true")
      return paymentJson(view(), 200, cors);
    // Only the creator of a new, frozen obligation may dispatch. An existing
    // request key returns its status and can never send the document again.
    const { data: source, error: sourceError } = await client.from("payper_noncard_payments")
      .select("method,document_type,reference_document_id,check_details,billing,amount_minor")
      .eq("payment_id", saved.paymentId).single();
    const { data: sale, error: saleError } = await client.from("sales")
      .select("items,discount,receipt_number,sale_date")
      .eq("id", saved.saleId).single();
    if (sourceError || saleError || !source || !sale) throw new PaymentHttpError(502, "source_unavailable");
    let payperRequest: ReturnType<typeof buildNoncardPayperRequest>;
    try {
      payperRequest = buildNoncardPayperRequest({
        amountMinor: source.amount_minor, method: source.method,
        documentType: source.document_type, referenceDocumentId: source.reference_document_id,
        receiptNumber: sale.receipt_number, paidDate: sale.sale_date,
        vatApplicable: ledger.source_facts?.vatApplicable,
        items: sale.items, discount: sale.discount,
        billing: source.billing, check: source.check_details,
      } as NoncardSource, { terminalNumber: required("PELECARD_TERMINAL"),
        user: required("PELECARD_USER"), password: required("PELECARD_PASSWORD") });
    } catch {
      await rpc("hold_payper_source", { p_payment_id: saved.paymentId });
      ledger.state = "source_blocked";
      ledger.reconciliation_code = "pre_dispatch_review_required";
      return paymentJson(view(), 200, cors);
    }
    await rpc("reserve_check_payper_dispatch", { p_payment_id: saved.paymentId });
    const outcome = await dispatchNoncardPayper(payperRequest);
    try {
      await rpc("record_check_payper_outcome", {
        p_payment_id: saved.paymentId, p_state: outcome.state,
        p_document_number: outcome.state === "succeeded" ? outcome.documentNumber : null,
        p_document_url: outcome.state === "succeeded" ? outcome.documentUrl : null,
        p_code: outcome.state === "succeeded" ? null : outcome.safeCode ?? "provider_response_uncertain",
        p_response_received: outcome.responseReceived === true,
        p_provider_status_code: outcome.providerStatusCode ?? null,
        p_invoice_status: outcome.invoiceStatus ?? null,
        p_invoice_error: outcome.invoiceError ?? null,
      });
    } catch {
      // The reservation remains durable. Never claim issuance if persistence
      // failed, even when the provider returned a successful response.
      throw new PaymentHttpError(502, "accounting_outcome_unresolved");
    }
    return paymentJson({ ...view(), accounting: outcome.state === "succeeded"
      ? { state: "succeeded", documentNumber: outcome.documentNumber,
        documentUrl: outcome.documentUrl, code: null }
      : { state: "reconciliation_required", documentNumber: null,
        documentUrl: null, code: outcome.safeCode ?? "provider_response_uncertain" } }, 200, cors);
  } catch (error) {
    const status = error instanceof PaymentHttpError ? error.status : 503;
    const code = error instanceof PaymentHttpError ? error.code : "collection_unavailable";
    return paymentJson({ error: { code } }, status, cors);
  }
});
