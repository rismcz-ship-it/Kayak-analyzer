/**
 * The one number formatter the UI shares. It lives in its own module because
 * the stat rows, the chart tooltip and the hull line must not drift apart:
 * the panels are supposed to read identically before and after the split, and
 * a single source makes that a property of the code rather than a habit.
 */
export const fmt = (v: number, digits = 1) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits })
