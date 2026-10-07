import { createClient } from "npm:@supabase/supabase-js@2.106.1";
import nodemailer from "npm:nodemailer@10.0.13";
import {
  boundedOperation,
  DeliveryError,
} from "../quotation-delivery/contract.js";
import { createDeliveryHandler } from "./handler.js";
import { createEmailProvider } from "./smtp.js";
import { createWhatsappProvider } from "./template.js";
export function orderDelivery(channel: "email" | "whatsapp") {
  const env = (key: string) => Deno.env.get(key) || "";
  const url = env("SUPABASE_URL"),
    anon = env("SUPABASE_ANON_KEY"),
    service = env("SUPABASE_SERVICE_ROLE_KEY");
  const db = url && service
    ? createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;
  async function result(operation: () => PromiseLike<any>) {
    const { data, error } = await boundedOperation(
      operation,
      10000,
      "database_unavailable",
    );
    if (error) {
      const allowed = [
        "delivery_request_conflict",
        "order_version_stale",
        "order_delivery_already_claimed",
        "order_not_found",
        "order_delivery_forbidden",
        "invalid_destination",
        "delivery_resend_parent_invalid", "delivery_resend_stale", "delivery_still_in_progress",
      ];
      throw new DeliveryError(
        allowed.includes(error.message)
          ? error.message
          : "order_delivery_database_unavailable",
        error.code === "PT409"
          ? 409
          : error.code === "PT404"
          ? 404
          : error.code === "42501"
          ? 403
          : 503,
      );
    }
    return data;
  }
  return createDeliveryHandler({
    channel,
    authorize: async (request: Request) => {
      if (!url || !anon || !db) {
        throw new DeliveryError("server_not_configured", 503);
      }
      const authorization = request.headers.get("Authorization");
      if (!authorization) {
        throw new DeliveryError("authentication_required", 401);
      }
      const caller = createClient(url, anon, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await boundedOperation(
        () => caller.auth.getUser(),
        10000,
        "authentication_unavailable",
      );
      if (error || !data?.user) {
        throw new DeliveryError("authentication_required", 401);
      }
      return {
        actorId: data.user.id,
        loadDocument: (orderId: string) =>
          result(() =>
            caller.rpc("order_confirmation_document", { p_order_id: orderId })
          ),
      };
    },
    repository: {
      getAttempt: (id: string) =>
        result(() =>
          db!.from("order_delivery_attempts").select("*").eq("id", id)
            .maybeSingle()
        ),
      claim: (input: any, selectedChannel: string, actorId: string) =>
        result(() =>
          db!.rpc(input.resendOf ? "claim_manual_order_delivery" : "claim_order_delivery", {
            p_request_id: input.requestId,
            p_order_id: input.orderId,
            p_version: input.version,
            p_channel: selectedChannel,
            p_actor_id: actorId,
            p_pdf_sha256: input.pdfHash,
            p_destination: input.destination,
            ...(input.resendOf ? {p_resend_of: input.resendOf} : {}),
          })
        ),
      finish: (
        requestId: string,
        actorId: string,
        state: string,
        reason: string | null,
        providerId: string | null,
      ) =>
        result(() =>
          db!.rpc("finish_order_delivery", {
            p_request_id: requestId,
            p_actor_id: actorId,
            p_state: state,
            p_reason: reason,
            p_provider_message_id: providerId,
          })
        ),
    },
    provider: channel === "email"
      ? createEmailProvider({
        user: env("GMAIL_USER"),
        password: env("GMAIL_APP_PASSWORD"),
        createTransport: nodemailer.createTransport,
      })
      : createWhatsappProvider({
        token: env("META_WHATSAPP_TOKEN"),
        phoneId: env("META_PHONE_NUMBER_ID"),
        wabaId: env("META_WABA_ID"),
      }),
  });
}
