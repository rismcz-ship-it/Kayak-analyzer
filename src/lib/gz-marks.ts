import type { GZPoint } from './hydrostatics'

/**
 * The angles a righting-arm curve is read by, derived from the SAME points the
 * chart draws. One definition, because the panel's "an end immerses first"
 * warning and the chart's markers must agree about them — two scans would
 * drift, and the warning would then contradict the drawing under it.
 */
export interface GzMarks {
  /**
   * Peak righting arm and the angle it occurs at. Null when no sampled angle
   * has a positive arm at all: such a hull has no "maximum righting arm", and
   * labelling its 0° zero anchor as a peak would claim stability it does not
   * have.
   */
  gzMax: GZPoint | null
  /**
   * Angle of vanishing stability, degrees — where the arm comes back down to
   * zero AFTER the peak, linearly interpolated between the two samples either
   * side so the number is the crossing and not the first sample past it. Null
   * when the curve never comes back to zero inside the sampled range (the
   * normal case for a hull still stable at the last sample), and null when
   * there is no positive arm to vanish from.
   */
  avsDeg: number | null
  /** Largest heel angle the curve samples, degrees; 0 when it samples none. */
  maxHeelDeg: number
}

/**
 * Scan for the peak arm and the vanishing angle that follows it.
 *
 * The AVS scan starts after the peak on purpose: the 0° anchor of every curve
 * is itself GZ = 0, so a scan from the start would report zero heel as the
 * vanishing angle and the curve would never look like a stability problem.
 */
export function gzMarks(curve: GZPoint[]): GzMarks {
  let peak = -1
  for (let i = 0; i < curve.length; i++) {
    if (peak === -1 || curve[i].GZ > curve[peak].GZ) peak = i
  }
  const hasPositiveArm = peak >= 0 && curve[peak].GZ > 0
  let avsDeg: number | null = null
  if (hasPositiveArm) {
    for (let i = peak + 1; i < curve.length; i++) {
      const lo = curve[i - 1]
      const hi = curve[i]
      if (hi.GZ <= 0) {
        // `lo` is the peak or a later sample that was still positive, so this
        // ratio is in [0, 1] and the angle lands between the two samples.
        const span = lo.GZ - hi.GZ
        const t = span > 0 ? lo.GZ / span : 0
        avsDeg = lo.heelDeg + t * (hi.heelDeg - lo.heelDeg)
        break
      }
    }
  }
  // Seeded from the first sample rather than from 0: the field promises the
  // largest angle the curve SAMPLES, and a 0 seed would clamp a curve whose
  // samples all sit below zero to an angle it never measured.
  let maxHeelDeg = curve.length > 0 ? curve[0].heelDeg : 0
  for (const p of curve) if (p.heelDeg > maxHeelDeg) maxHeelDeg = p.heelDeg
  return {
    gzMax: hasPositiveArm ? curve[peak] : null,
    avsDeg,
    maxHeelDeg,
  }
}

/**
 * The two angles of a curve where an end wets before the arm vanishes, both
 * non-null by construction. The panel's warning formats both of them, so
 * returning the pair it compared means the message is built from values
 * TypeScript already knows are real.
 */
export interface EndTipFirst {
  /** Angle at which a stem tip reaches the water, degrees. */
  endTipDeg: number
  /** Angle at which the righting arm comes back down to zero, degrees. */
  avsDeg: number
}

/**
 * Whether a stem tip wets BEFORE the righting arm vanishes — the one ordering
 * of the two angles that changes how the curve reads. Null when it does not.
 *
 * Both angles must exist for the answer to be yes: with no AVS there is no
 * vanishing angle to be early against, and with no end-tip angle nothing wets
 * at all. Strictly before, so an end that wets exactly at the vanishing angle
 * coincides with it rather than warning.
 *
 * It lives here rather than in the panel's JSX because this ordering is what
 * the Task 9 cross-review's BLOCKER was about: the warning used to fire
 * whenever both numbers existed, so a hull whose end stayed dry well PAST its
 * vanishing angle was still told "an end immerses before the vanishing angle"
 * — a false safety claim, asserted from a branch no test could reach.
 */
export function endTipWetsBeforeVanishing(
  endTipDeg: number | null,
  marks: GzMarks,
): EndTipFirst | null {
  if (endTipDeg === null || marks.avsDeg === null || endTipDeg >= marks.avsDeg) return null
  return { endTipDeg, avsDeg: marks.avsDeg }
}
