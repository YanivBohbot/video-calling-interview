// Runs `flush` every `intervalMs`, never overlapping: a tick that lands while the
// previous flush is still in flight is skipped.
export const createFlushScheduler = ({ flush, intervalMs }) => {
  let timer = null;
  let inFlight = null;

  const run = () => {
    inFlight = Promise.resolve()
      .then(flush)
      .catch((err) => console.error("roomState: periodic flush error:", err.message))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    start: () => {
      timer ??= setInterval(() => {
        if (!inFlight) run();
      }, intervalMs);
    },
    stop: () => {
      clearInterval(timer);
      timer = null;
    },
    // Waits for any in-flight pass, then flushes once more (used at shutdown).
    flushNow: async () => {
      if (inFlight) await inFlight;
      await run();
    },
  };
};
