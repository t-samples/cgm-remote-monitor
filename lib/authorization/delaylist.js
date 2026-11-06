'use strict';

function init(env) {
  const entries = new Map();
  const capacity = 4096;
  const age = 60000;
  const step = Math.min(age, Math.max(1, Number(env.settings && env.settings.authFailDelay) || 5000));
  let sweepAfter = 0;
  let overflowUntil = 0;

  function prune(now) {
    if (now < sweepAfter) return;
    sweepAfter = now + 30000;
    for (const [ip, until] of entries) {
      if (until + age <= now) entries.delete(ip);
    }
  }

  return {
    addFailedRequest(ip) {
      const now = Date.now();
      prune(now);
      const previous = entries.get(ip);
      if (previous === undefined && entries.size >= capacity) {
        overflowUntil = Math.min(now + age, Math.max(now, overflowUntil) + step);
        return;
      }
      entries.set(ip, Math.min(now + age, Math.max(now, previous || 0) + step));
    },
    shouldDelayRequest(ip) {
      const now = Date.now();
      prune(now);
      return Math.max(0, (entries.get(ip) || overflowUntil) - now) || false;
    },
    requestSucceeded(ip) {
      entries.delete(ip);
    }
  };
}

module.exports = init;
