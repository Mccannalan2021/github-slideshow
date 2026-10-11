// Shared fetch helper for providers: timeout plus readable upstream errors.
async function fetchJson(fetchImpl, url, options = {}, { timeoutMs = 10_000, label = 'upstream' } = {}) {
  const res = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!res.ok || data === null) {
    const err = new Error(`${label} request failed (${res.status})`);
    err.status = 502;
    err.detail = text.slice(0, 300);
    throw err;
  }
  return data;
}

module.exports = { fetchJson };
