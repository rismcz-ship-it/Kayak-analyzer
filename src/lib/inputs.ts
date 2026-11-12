/**
 * The app's input layer: what counts as a number, what range each input is
 * allowed, how the form validates itself and how the browser remembers a set
 * of inputs. It lives in its own module, out of the component, for one reason:
 * `App.tsx` held all of it privately and nothing in `tests/` could import it,
 * so the whole path from a keystroke to a solve ran with no assertions. That is
 * the defect class that produced Task 6's untested gates and Task 9's
 * unreachable JSX condition, and the fix here is the repo's own seam — the same
 * one `gz-marks.ts` uses — pulled over to the inputs.
 *
 * One rule holds the module together: the FORM and the RESTORE share one gate.
 * `parseInputs` and `readStoredInputs` judge every value with the same
 * `*Usable` predicate below, so a value the form rejects can never be one the
 * restore offers — that sharing is what stops a stored `kgMm: 0` booting the
 * app with Calculate permanently disabled. Every bound is therefore exported
 * once and read by both paths, and `verify-inputs.ts` drives each of them
 * through both.
 *
 * Layering, stated so it is not a surprise: the imports are `fmt` for the
 * scale notices, the *type* `ScaleAdvice` (erased at compile time) and one
 * value, `DEFAULT_KG_MM`, from the solver — so loading this module loads the
 * solver graph. Both modules are framework-free, so the suite still runs in
 * Node with no browser shims. The constant stays in `hydrostatics.ts` because
 * that is where `AGENTS.md` puts the KG default, and the alternative is a
 * second copy of it free to drift from the one the solver uses.
 */
import { fmt } from './format'
import type { ScaleAdvice } from './geometry'
import { DEFAULT_KG_MM } from './hydrostatics'

/**
 * Bounds for the three numeric inputs. Outside them there is no honest answer
 * to give: under 20 kg is not a paddler plus gear plus boat, over 200 kg is,
 * and a KG above 1000 mm puts the centre of gravity above the deck of any
 * kayak, where GM stops describing anything real.
 */
export const WEIGHT_MIN = 20
export const WEIGHT_MAX = 200
export const LCG_MIN = 0
export const LCG_MAX = 100
export const KG_MIN = 0
export const KG_MAX = 1000
/**
 * The heel slider's own range, enforced on the restored value too.
 *
 * Deliberately narrower than the solver's `DEFAULT_GZ_HEEL_ANGLES_DEG` (which
 * runs to 45°): the curve is plotted that far for completeness, but asking for
 * a heel to be *solved* past ~30° leaves the range where wall-sided GM/BM says
 * anything real about a hull this small.
 */
export const HEEL_MIN = -30
export const HEEL_MAX = 30

/** Versioned so a future schema change can tell its own entries apart. */
export const INPUTS_STORAGE_KEY = 'kayak-analyzer.inputs.v1'

/** The three text fields; the numbers are derived from these, never the reverse. */
export type NumericInputs = {
  weightInput: string
  lcgInput: string
  kgInput: string
}

/** All input state, raw strings plus the fixed-heel toggle behind them. */
export type InputFields = NumericInputs & {
  heelDeg: number
  showHeelInput: boolean
}

export type ParsedInputs = {
  /** Each field's number — null only when THAT field alone is unusable. */
  weightKg: number | null
  lcgPercent: number | null
  kgMm: number | null
  /** Each field's own reason, so it can sit under the control it names. */
  weightError: string | null
  lcgError: string | null
  kgError: string | null
  /** The first failure in weight → LCG → KG order; null only when all three are usable. */
  inputError: string | null
}

/** The state the app persists when it has a complete, valid form. */
export type PersistableInputs = {
  weightKg: number | null
  lcgPercent: number | null
  kgMm: number | null
  heelDeg: number
  showHeelInput: boolean
}

/**
 * The storage read the module needs, and no more. It is a function rather than
 * `Storage` so a test can hand it a bag of strings, a throwing stub or nothing
 * at all, and so the browser's storage can throw on *access* (private mode)
 * with the throw still happening inside this module's try/catch.
 */
export type StorageReader = (key: string) => string | null

/**
 * `Number('')` is 0 — the historic defect that produced this rule, fixed in
 * `4b6ba2a` when the state moved from numeric setters to raw strings: clearing
 * a field must never hand the solver a 0 kg kayak. Empty, whitespace and
 * anything non-finite are "no number", never 0.
 */
export function toNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

/**
 * One named predicate per field, shared by the input validation and the
 * restore path — the single gate that keeps a stored value the form rejects
 * (a KG of 0) from booting the app with Calculate permanently disabled.
 */
export const weightUsable = (value: number): boolean => inRange(value, WEIGHT_MIN, WEIGHT_MAX)
export const lcgUsable = (value: number): boolean => inRange(value, LCG_MIN, LCG_MAX)
export const heelUsable = (value: number): boolean => inRange(value, HEEL_MIN, HEEL_MAX)
// KG is a height above the keel, so 0 is not merely out of range: it puts the
// centre of gravity in the keel, and solveTrim refuses it.
export const kgUsable = (value: number): boolean => value > KG_MIN && value <= KG_MAX

/** One field: either a number the solver can consume, or why it cannot. */
function parseField(
  raw: string,
  usable: (value: number) => boolean,
  notANumber: string,
  outOfRange: string,
): { value: number | null; error: string | null } {
  const value = toNumber(raw)
  if (value === null) return { value: null, error: notANumber }
  if (!usable(value)) return { value: null, error: outOfRange }
  return { value, error: null }
}

/**
 * The single validation point for the three inputs. Everything that needs to
 * know whether a solve is currently legitimate goes through it — the render,
 * the disabled condition, the persist effect and the click handler — so the
 * button's state and the run cannot disagree about what is valid. Each field
 * is judged on its own, so a cleared weight neither blanks the KG nor hides
 * the warning about it.
 */
export function parseInputs(fields: NumericInputs): ParsedInputs {
  const weight = parseField(
    fields.weightInput,
    weightUsable,
    'Target weight: enter a number.',
    `Target weight must be ${WEIGHT_MIN}–${WEIGHT_MAX} kg.`,
  )
  const lcg = parseField(
    fields.lcgInput,
    lcgUsable,
    'LCG: enter a number.',
    `LCG must be ${LCG_MIN}–${LCG_MAX} %.`,
  )
  const kg = parseField(
    fields.kgInput,
    kgUsable,
    'KG: enter a number.',
    `KG must be above ${KG_MIN} mm and at most ${KG_MAX} mm.`,
  )
  return {
    weightKg: weight.value,
    lcgPercent: lcg.value,
    kgMm: kg.value,
    weightError: weight.error,
    lcgError: lcg.error,
    kgError: kg.error,
    inputError: weight.error ?? lcg.error ?? kg.error ?? null,
  }
}

/**
 * Read the persisted inputs once, at mount. Anything untrustworthy — no
 * localStorage at all (or one that throws on access), malformed JSON, a value
 * out of today's range — falls back per field, and a throw falls back entirely.
 * A stored value the current rules reject is not better than the default, and
 * a note written into the browser's storage must never stop the app from
 * booting.
 */
export function readStoredInputs(read: StorageReader): InputFields {
  let stored: Record<string, unknown> = {}
  try {
    const raw = read(INPUTS_STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        stored = parsed as Record<string, unknown>
      }
    }
  } catch {
    // Private mode, a disabled storage API, hand-edited JSON: keep the
    // defaults below instead of failing the boot.
  }
  const numIn = (key: string, usable: (value: number) => boolean, fallback: number): number => {
    const value = stored[key]
    return typeof value === 'number' && Number.isFinite(value) && usable(value) ? value : fallback
  }
  const weightKg = numIn('weightKg', weightUsable, 75)
  const lcgPercent = numIn('lcgPercent', lcgUsable, 52)
  const kgMm = numIn('kgMm', kgUsable, DEFAULT_KG_MM)
  const heelDeg = numIn('heelDeg', heelUsable, 0)
  return {
    weightInput: String(weightKg),
    lcgInput: String(lcgPercent),
    kgInput: String(kgMm),
    heelDeg,
    // A non-zero heel only exists because the toggle was on when it was
    // saved. Restoring it in the off state would silently not apply it.
    showHeelInput: heelDeg !== 0,
  }
}

/**
 * The record to persist, or null when there is nothing honest to write: an
 * incomplete form keeps the last good set rather than writing the empty one.
 *
 * The APPLIED heel is the value stored, not the slider's leftover — with the
 * toggle off the fixed heel is 0 whatever the slider still reads, and storing
 * the slider value would resurrect a heel the user switched off on the next
 * reload.
 */
export function encodeStoredInputs(fields: PersistableInputs): string | null {
  if (fields.weightKg === null || fields.lcgPercent === null || fields.kgMm === null) return null
  return JSON.stringify({
    weightKg: fields.weightKg,
    lcgPercent: fields.lcgPercent,
    kgMm: fields.kgMm,
    heelDeg: fields.showHeelInput ? fields.heelDeg : 0,
  })
}

/**
 * The scale notice wording, one line per band of `scaleAdviceFor`.
 *
 * Deliberately reports the extent in the file's own units rather than naming a
 * unit the app cannot know: an inch-authored hull (120 units) is caught by the
 * same rule as a metres-authored one, and printing "120.00 m" would state a
 * false magnitude.
 */
export function scaleNotice(advice: ScaleAdvice, maxDim: number): string {
  if (advice.kind === 'metres') {
    return (
      `Largest axis ${fmt(maxDim, 2)} in the file's own units — a kayak is thousands of mm ` +
      'long, so this is probably a metres file: lengths would read 1000× too small and ' +
      'volumes 10⁹× too small.'
    )
  }
  if (advice.kind === 'small') {
    return (
      `Largest axis ${fmt(maxDim)} in the file's own units — too short for a kayak in mm, ` +
      'and too long to be metres. If the STL is in cm or inches its lengths read 10× / 25.4× ' +
      'too small; rescale the mesh to mm.'
    )
  }
  return (
    `Largest axis ${fmt(maxDim)} mm — larger than 10 m. Check the STL's units; the app ` +
    'assumes mm.'
  )
}
