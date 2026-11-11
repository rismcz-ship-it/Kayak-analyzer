/**
 * The one number formatter the UI shares. It lives in its own module because
 * the stat rows, the chart tooltip and the hull line must not drift apart:
 * the panels are supposed to read identically before and after the split, and
 * a single source makes that a property of the code rather than a habit.
 */
export const fmt = (v: number, digits = 1) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits })

/**
 * `fmt` with the sign always shown. Trim, the fixed heel and LCF are read for
 * their DIRECTION, so an unsigned "30" is ambiguous next to a label ending in
 * "X" — and the ternary that produced it had already been copied into three
 * sites, which is how the chart and the panel came to disagree about it.
 * Same digits, same rounding, one definition.
 */
export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${fmt(v, digits)}`
