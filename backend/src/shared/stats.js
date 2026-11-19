const DEFAULT_DURATION_MINUTES = 60;

// Rounded mean of interview durations; a missing duration counts as the 60-minute default.
export const averageDuration = (durations) =>
  durations.length
    ? Math.round(durations.reduce((sum, d) => sum + (d || DEFAULT_DURATION_MINUTES), 0) / durations.length)
    : 0;
