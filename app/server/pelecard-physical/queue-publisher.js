const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDirectQueuePublisher(send) {
  return async paymentId => {
    if (!uuid.test(paymentId ?? '')) throw new Error('physical_queue_intent_invalid');
    const accepted = await send('physical-j4-dispatch', { paymentId },
      { idempotencyKey: paymentId, retentionSeconds: 86_400 });
    if (typeof accepted?.messageId !== 'string' || !accepted.messageId)
      throw new Error('physical_queue_unacknowledged');
    return accepted.messageId;
  };
}
