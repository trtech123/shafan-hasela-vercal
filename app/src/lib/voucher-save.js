// A timeout is an unknown outcome, never permission to create another voucher.
export async function boundedVoucherRequest(query, milliseconds = 15000) {
  const controller = new AbortController();
  let timer;
  const result = typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
  try {
    return await Promise.race([
      Promise.resolve(result),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('voucher_request_timeout'));
          controller.abort();
        }, milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function findOrderVoucher(client, orderId) {
  const { data, error } = await boundedVoucherRequest(client.from('hakafa_vouchers').select('*').eq('order_id', orderId).maybeSingle());
  if (error) throw error;
  return data || null;
}

export async function saveVoucher(client, request) {
  const existing = await findOrderVoucher(client, request.p_data.order_id);
  if (existing) return existing;
  try {
    const { data, error } = await boundedVoucherRequest(client.rpc('create_hakafa_voucher', request));
    if (error) throw error;
    if (!data?.id) throw new Error('empty_voucher');
    return data;
  } catch (error) {
    // Covers a lost response and a concurrent tab winning the unique order claim.
    // Never log the request/signature; never retry the write automatically.
    const recovered = await findOrderVoucher(client, request.p_data.order_id).catch(() => null);
    if (recovered) return recovered;
    throw error;
  }
}
