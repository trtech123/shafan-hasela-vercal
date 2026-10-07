function ensure(result, operation) {
  if (result?.error) throw new Error(`handoff_${operation}_failed`);
  return result?.data;
}

export function createHandoffOperations({ serviceSupabase, sender }) {
  return {
    forUser(userSupabase) {
      async function runStateChange(functionName, handoffId) {
        const data = ensure(await userSupabase.rpc(functionName, { p_handoff_id: handoffId }), functionName);
        return data === true;
      }

      return {
        claim(handoffId) {
          return runStateChange("claim_bot_handoff", handoffId);
        },
        resume(handoffId) {
          return runStateChange("resume_bot_conversation", handoffId);
        },
        resolve(handoffId) {
          return runStateChange("resolve_bot_handoff", handoffId);
        },
        close(handoffId) {
          return runStateChange("close_bot_handoff", handoffId);
        },

        async reply(handoffId, userId, message) {
          const handoff = ensure(await serviceSupabase
        .from("bot_handoffs")
        .select("id,conversation_id,conversation:bot_conversations!inner(id,channel,contact:bot_contacts!inner(external_contact_id))")
        .eq("id", handoffId)
        .eq("status", "active")
        .eq("assigned_to", userId)
        .single(), "load_reply_context");

          const conversation = handoff?.conversation;
          const contact = conversation?.contact;
          if (conversation?.channel !== "whatsapp" || !contact?.external_contact_id) {
            throw new Error("handoff_reply_context_failed");
          }

          const outbound = ensure(await serviceSupabase
        .from("bot_messages")
        .insert({
          conversation_id: conversation.id,
          channel: "whatsapp",
          direction: "outbound",
          message_kind: "staff_reply",
          body: message,
          delivery_status: "pending",
          occurred_at: new Date().toISOString(),
          sanitized_metadata: { staff_user_id: userId },
        })
        .select("id")
        .single(), "persist_reply");

          try {
            const delivery = await sender.sendText({
          channel: "whatsapp",
          to: contact.external_contact_id,
          text: message,
        });
            ensure(await serviceSupabase.from("bot_messages").update({
          delivery_status: "accepted",
          provider_message_id: delivery.providerMessageId,
        }).eq("id", outbound.id), "complete_reply");
            ensure(await serviceSupabase.from("bot_handoffs").update({
          first_human_response_at: new Date().toISOString(),
        }).eq("id", handoffId).is("first_human_response_at", null), "mark_first_response");
            return delivery;
          } catch (error) {
            await serviceSupabase.from("bot_messages").update({ delivery_status: "failed" }).eq("id", outbound.id);
            throw error;
          }
        },
      };
    },
  };
}
