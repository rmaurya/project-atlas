/**
 * Number formatting that does not depend on where the machine thinks it is. (A-33)
 *
 * `Number.prototype.toLocaleString()` with no argument reads the host locale. Under `en-IN` — the default on
 * this project's own author's machine — 126,200,000 renders as `12,62,00,000`. That is correct for the
 * reader and wrong for this tool, because the same commit then builds **different bytes** in two places.
 *
 * Byte-identical rebuild is not a nicety here. It is the property the build stamp exists to assert, the
 * property that makes "the derived layer is regenerable" a checkable claim rather than a promise, and the
 * property a publish diff relies on to show only what actually changed. A grouping separator chosen by an
 * environment variable silently breaks all three, and it breaks them in a way that looks like real churn:
 * every number in the site appears to have changed.
 *
 * So the locale is pinned, everywhere, in one place. `en-US` is not a statement about the audience — it is an
 * arbitrary fixed point, chosen because the corpus is written in English and the existing pinned call site in
 * `dashboard.mjs` already used it. Any fixed locale would do; what matters is that it is fixed.
 *
 * **This is the only correct way to group a digit in this codebase.** A bare `toLocaleString()` added later
 * reintroduces the defect silently, on one machine only, and a test pins that.
 */

/** The pinned locale. Arbitrary, fixed, and the whole point is that it never varies. */
export const NUM_LOCALE = 'en-US';

/**
 * A grouped integer, or an em dash when there is no number.
 *
 * Non-finite input returns `—` rather than `NaN`: a missing measurement and a measured zero are different
 * claims throughout this tool, and `NaN` renders as neither.
 */
export function num(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString(NUM_LOCALE) : '—';
}
