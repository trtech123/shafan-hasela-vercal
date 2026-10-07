function ensure(result, operation) {
  if (result?.error) throw new Error(`chatbot_repository_${operation}`);
  return result?.data;
}

export function mapConversation(row) {
  return {
    id: row.id,
    status: row.status,
    currentState: row.current_state,
    parentState: row.parent_state ?? null,
    selectedSite: row.selected_site ?? null,
    selectedActivity: row.selected_activity ?? null,
    collectedFields: row.collected_fields ?? {},
  };
}

function mapContact(row) {
  return { id: row.id, externalContactId: row.external_contact_id };
}

export function createChatbotRepository(supabase) {
  async function findActiveConversation(channel, threadId) {
    const result = await supabase
      .from("bot_conversations")
      .select("id,status,current_state,parent_state,selected_site,selected_activity,collected_fields")
      .eq("channel", channel)
      .eq("thread_id", threadId)
      .in("status", ["automated", "awaiting_human", "human_active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return ensure(result, "find_conversation");
  }

  return {
    async claimEvent(event) {
      const data = ensure(await supabase.rpc("claim_bot_channel_event", {
        p_channel: event.channel,
        p_provider_event_id: event.providerEventId,
        p_provider_message_id: event.providerMessageId ?? null,
        p_event_kind: event.eventKind,
        p_payload_digest: event.payloadDigest,
        p_occurred_at: event.occurredAt,
        p_sanitized_metadata: event.sanitizedMetadata ?? {},
      }), "claim_event");
      const row = data?.[0];
      if (!row) throw new Error("chatbot_repository_claim_event");
      return { eventId: row.event_id, claimed: row.claimed, resumed: row.resumed };
    },

    async upsertVerifiedContact(contact) {
      const result = await supabase
        .from("bot_contacts")
        .upsert({
          channel: contact.channel,
          external_contact_id: contact.externalContactId,
          display_name: contact.displayName,
          phone: contact.verifiedPhone,
          verification_source: contact.verificationSource,
          verified_at: contact.verifiedAt,
        }, { onConflict: "channel,external_contact_id" })
        .select("id,external_contact_id")
        .single();
      return mapContact(ensure(result, "upsert_contact"));
    },

    async getOrCreateConversation({ contactId, channel, threadId, contentVersion, occurredAt }) {
      const existing = await findActiveConversation(channel, threadId);
      if (existing) return mapConversation(existing);

      const result = await supabase
        .from("bot_conversations")
        .insert({
          contact_id: contactId,
          channel,
          thread_id: threadId,
          content_version: contentVersion,
          last_message_at: occurredAt,
        })
        .select("id,status,current_state,parent_state,selected_site,selected_activity,collected_fields")
        .single();
      if (result.error?.code === "23505") {
        const raced = await findActiveConversation(channel, threadId);
        if (raced) return mapConversation(raced);
      }
      return mapConversation(ensure(result, "create_conversation"));
    },

    async insertInboundMessage(message) {
      const result = await supabase
        .from("bot_messages")
        .insert({
          conversation_id: message.conversationId,
          trigger_event_id: message.triggerEventId,
          channel: message.channel,
          provider_message_id: message.providerMessageId,
          direction: "inbound",
          message_kind: message.messageKind,
          body: message.body,
          sanitized_metadata: message.sanitizedMetadata,
          occurred_at: message.occurredAt,
        })
        .select("id")
        .single();
      return ensure(result, "insert_inbound");
    },

    async updateConversation(conversationId, session, occurredAt) {
      ensure(await supabase
        .from("bot_conversations")
        .update({
          status: session.status,
          current_state: session.currentState,
          parent_state: session.parentState,
          selected_site: session.selectedSite,
          selected_activity: session.selectedActivity,
          collected_fields: session.collectedFields,
          last_message_at: occurredAt,
        })
        .eq("id", conversationId), "update_conversation");
    },

    async createHandoff({ conversationId, reason, priority, summary, capture }) {
      const data = ensure(await supabase.rpc("create_bot_handoff", {
        p_conversation_id: conversationId,
        p_reason: reason,
        p_priority: priority,
        p_summary: summary,
        p_capture: capture,
      }), "create_handoff");
      const row = data?.[0];
      if (!row) throw new Error("chatbot_repository_create_handoff");
      return { handoffId: row.handoff_id, leadId: row.lead_id };
    },

    async recordAction(action) {
      ensure(await supabase.from("bot_action_events").insert({
        conversation_id: action.conversationId,
        trigger_event_id: action.triggerEventId,
        action_id: action.actionId,
        idempotency_key: action.idempotencyKey,
        availability: action.availability,
        outcome: action.outcome,
        failure_code: action.failureCode,
      }), "record_action");
    },

    async insertOutboundMessage(message) {
      const result = await supabase
        .from("bot_messages")
        .insert({
          conversation_id: message.conversationId,
          trigger_event_id: message.triggerEventId,
          channel: message.channel,
          direction: "outbound",
          message_kind: message.messageKind,
          body: message.body,
          response_id: message.responseId,
          delivery_status: "pending",
          occurred_at: message.occurredAt,
        })
        .select("id,body,response_id")
        .single();
      const row = ensure(result, "insert_outbound");
      return { id: row.id, body: row.body, responseId: row.response_id };
    },

    async updateOutboundDelivery(messageId, delivery) {
      const changes = { delivery_status: delivery.status };
      if (delivery.providerMessageId) changes.provider_message_id = delivery.providerMessageId;
      ensure(await supabase.from("bot_messages").update(changes).eq("id", messageId), "update_outbound");
    },

    async listRetryableOutbound(eventId) {
      const result = await supabase
        .from("bot_messages")
        .select("id,body,response_id")
        .eq("trigger_event_id", eventId)
        .eq("direction", "outbound")
        .in("delivery_status", ["pending", "failed"])
        .order("created_at", { ascending: true });
      return (ensure(result, "list_retryable") ?? []).map((row) => ({
        id: row.id,
        body: row.body,
        responseId: row.response_id,
      }));
    },

    async updateDeliveryStatus(channel, providerMessageId, status, occurredAt) {
      ensure(await supabase
        .from("bot_messages")
        .update({ delivery_status: status, sanitized_metadata: { status_occurred_at: occurredAt } })
        .eq("channel", channel)
        .eq("provider_message_id", providerMessageId), "delivery_status");
    },

    async completeEvent(eventId) {
      ensure(await supabase
        .from("bot_channel_events")
        .update({ processing_status: "completed", processed_at: new Date().toISOString(), retry_after: null })
        .eq("id", eventId), "complete_event");
    },

    async failEvent(eventId, errorCode) {
      const retryAfter = new Date().toISOString();
      ensure(await supabase
        .from("bot_channel_events")
        .update({ processing_status: "failed", error_code: errorCode, retry_after: retryAfter })
        .eq("id", eventId), "fail_event");
    },
  };
}
