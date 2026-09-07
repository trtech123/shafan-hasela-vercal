export class NetworkTimeoutError extends Error {
  constructor() {
    super("network timeout");
    this.name = "NetworkTimeoutError";
    this.code = "network_timeout";
  }
}

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new NetworkTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
