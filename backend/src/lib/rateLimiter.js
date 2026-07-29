// In-memory sliding-window limiter keyed by an arbitrary string (e.g. clerkId).
// Process-local — fine for a single-instance deployment.
export const createRateLimiter = ({ max, windowMs }) => {
  const hits = new Map(); // key -> number[] (timestamps ms)

  const check = (key) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);

    if (arr.length >= max) {
      const oldest = arr[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      hits.set(key, arr);
      return { ok: false, retryAfter };
    }

    arr.push(now);
    hits.set(key, arr);
    return { ok: true };
  };

  return { check };
};
