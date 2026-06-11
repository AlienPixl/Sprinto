// Sliding-window in-memory rate limiter.
// Single-instance app — no Redis needed; the Map never outlives the process.

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

export function createRateLimiter({ limit, windowMs, keyFn, message = "Too many requests. Please slow down." }) {
  const store = new Map(); // key -> timestamp[]

  // Sweep expired entries to prevent unbounded memory growth.
  // unref() so this timer never keeps the process alive on graceful shutdown.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of store) {
      const live = timestamps.filter((t) => t > cutoff);
      if (live.length === 0) store.delete(key);
      else store.set(key, live);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (store.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      return res.status(429).json({ error: message });
    }

    timestamps.push(now);
    store.set(key, timestamps);
    next();
  };
}

export const keyByUserId = (req) => req.user?.id ?? null;
export const keyByIp = clientIp;

// WebSocket rate limiter — returns a check function called per message.
// Returns false when the socket has exceeded the limit (caller should drop the message).
export function createWsRateLimiter({ limit, windowMs }) {
  return function checkWsLimit(socket) {
    const now = Date.now();
    const cutoff = now - windowMs;
    socket._wsTimestamps = (socket._wsTimestamps || []).filter((t) => t > cutoff);
    if (socket._wsTimestamps.length >= limit) return false;
    socket._wsTimestamps.push(now);
    return true;
  };
}
