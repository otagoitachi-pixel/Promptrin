// Best-effort rate limiting kept in the Worker's memory.
//
// Honest limits: Cloudflare may run several copies of a Worker, and each copy has its own counters, so this
// slows down floods and password guessing but is not a hard guarantee. For a hard limit add the optional
// GPT_LIMIT rate-limit binding or a WAF rate-limiting rule (see docs/GPT-ACTION-SETUP.md).
export function createLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    /** Records one hit for `key`; returns { ok, retryAfter } (seconds). */
    hit(key, now = Date.now(), max = limit) {
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n++;
      return e.n > max ? { ok: false, retryAfter: Math.max(1, Math.ceil((e.reset - now) / 1000)) } : { ok: true, retryAfter: 0 };
    },
    /** Only checks, does not count. */
    blocked(key, now = Date.now()) {
      const e = hits.get(key);
      return !!e && e.reset > now && e.n > limit;
    },
    reset() { hits.clear(); },
  };
}
