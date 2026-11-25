/**
 * The rail mark: the test hull's midship section at the LCG station, drawn
 * from the mesh with the solver's own waterline, centres and dimensions.
 *
 * Extracted from the approved mockup (`docs/mockups/wip/analyze-03-empty.html`)
 * rather than redrawn: it is a hydrostatic figure, and every line on it is a
 * measured value. At rail size it reads as a hull section in water — that is
 * the honest limit of a 34 px slot for a 2714 x 271 mm boat.
 */
interface HullMarkProps {
  className?: string
}

export default function HullMark({ className }: HullMarkProps) {
  return (
    <svg viewBox="0.5 9.3 30.7 19.1" fill="none" aria-hidden="true" className={className}>
      {/* 1. the displaced volume: the part of this hull below the waterline */}
      <path
        d="M 3.00 19.25 L 3.03 19.43 L 3.03 19.43 L 3.13 19.82 L 3.13 19.82 L 3.23 20.10 L 3.23 20.10 L 3.34 20.39 L 3.36 20.42 L 3.50 20.73 L 3.53 20.77 L 3.70 21.09 L 3.76 21.17 L 4.20 21.79 L 4.24 21.83 L 4.48 22.10 L 4.51 22.14 L 4.75 22.37 L 4.78 22.39 L 5.00 22.59 L 5.00 22.59 L 5.18 22.73 L 5.20 22.74 L 5.35 22.86 L 5.37 22.87 L 5.51 22.96 L 5.51 22.96 L 5.60 23.03 L 5.61 23.03 L 5.69 23.08 L 5.69 23.08 L 5.76 23.12 L 5.76 23.12 L 5.79 23.13 L 5.80 23.13 L 5.88 23.11 L 5.90 23.09 L 6.10 23.00 L 6.10 23.00 L 6.15 22.99 L 6.15 22.99 L 6.20 22.98 L 6.20 22.98 L 6.23 22.98 L 6.23 22.98 L 6.26 22.99 L 6.27 22.99 L 6.34 23.01 L 6.34 23.01 L 6.44 23.05 L 6.48 23.06 L 6.68 23.13 L 6.72 23.14 L 7.01 23.23 L 7.11 23.27 L 7.86 23.51 L 7.86 23.51 L 8.21 23.61 L 8.26 23.62 L 8.57 23.71 L 8.64 23.73 L 9.10 23.84 L 9.15 23.85 L 9.52 23.92 L 9.60 23.93 L 10.24 23.99 L 10.33 24.00 L 11.02 24.04 L 11.12 24.05 L 11.90 24.09 L 12.01 24.10 L 12.86 24.14 L 12.98 24.14 L 13.87 24.17 L 14.14 24.17 L 16.00 24.20 L 16.27 24.20 L 18.13 24.17 L 18.25 24.17 L 19.14 24.14 L 19.26 24.13 L 20.10 24.09 L 20.20 24.09 L 20.98 24.04 L 21.07 24.04 L 21.76 23.99 L 21.85 23.98 L 22.53 23.91 L 22.53 23.91 L 22.97 23.83 L 22.97 23.83 L 23.48 23.70 L 23.48 23.70 L 23.88 23.59 L 23.94 23.57 L 24.38 23.43 L 24.44 23.41 L 24.93 23.26 L 24.93 23.26 L 25.29 23.14 L 25.32 23.13 L 25.48 23.07 L 25.50 23.06 L 25.63 23.02 L 25.63 23.02 L 25.73 22.99 L 25.74 22.99 L 25.77 22.98 L 25.77 22.98 L 25.81 22.98 L 25.81 22.98 L 25.86 22.99 L 25.86 22.99 L 25.91 23.01 L 25.94 23.02 L 26.17 23.12 L 26.17 23.12 L 26.22 23.13 L 26.22 23.13 L 26.25 23.12 L 26.26 23.11 L 26.32 23.08 L 26.34 23.07 L 26.49 22.96 L 26.49 22.96 L 26.64 22.86 L 26.64 22.86 L 26.80 22.75 L 26.82 22.73 L 27.04 22.55 L 27.04 22.55 L 27.29 22.34 L 27.29 22.34 L 27.60 22.02 L 27.60 22.02 L 27.91 21.65 L 27.91 21.65 L 28.20 21.25 L 28.20 21.25 L 28.42 20.88 L 28.44 20.83 L 28.62 20.47 L 28.64 20.43 L 28.78 20.10 L 28.79 20.07 L 28.89 19.78 L 28.89 19.76 L 28.96 19.52 L 28.96 19.50 L 29.00 19.29 L 29.00 19.28 L 29.00 19.25 Z"
        fill="currentColor"
        fillOpacity="0.3"
      />
      {/* 2. the real section at the LCG station, cockpit and all */}
      <path
        d="M 13.68 12.69 L 12.20 12.69 L 11.37 12.68 L 11.15 12.68 L 10.21 12.68 L 10.10 12.68 L 8.23 12.68 L 7.91 12.68 L 7.29 12.68 L 7.00 12.68 L 6.81 12.68 L 7.28 12.69 L 7.45 12.71 L 7.54 12.73 L 7.56 12.74 L 7.60 12.77 L 7.62 12.79 L 7.63 12.81 L 7.63 12.84 L 7.64 12.91 L 7.61 13.00 L 7.58 13.08 L 7.53 13.15 L 7.47 13.22 L 7.30 13.33 L 7.18 13.37 L 7.15 13.37 L 6.83 13.40 L 6.49 13.40 L 6.34 13.41 L 6.22 13.41 L 6.09 13.42 L 5.85 13.45 L 5.61 13.53 L 5.34 13.67 L 4.97 13.91 L 4.63 14.19 L 4.02 14.94 L 3.73 15.49 L 3.45 16.24 L 3.25 16.97 L 3.00 18.60 L 2.98 19.09 L 3.03 19.43 L 3.13 19.82 L 3.23 20.10 L 3.50 20.73 L 3.70 21.09 L 4.24 21.83 L 4.51 22.14 L 5.00 22.59 L 5.18 22.73 L 5.37 22.87 L 5.51 22.96 L 5.61 23.03 L 5.76 23.12 L 5.79 23.13 L 5.90 23.09 L 6.10 23.00 L 6.20 22.98 L 6.23 22.98 L 6.27 22.99 L 6.34 23.01 L 6.68 23.13 L 7.01 23.23 L 7.86 23.51 L 8.26 23.62 L 8.64 23.73 L 9.52 23.92 L 10.24 23.99 L 11.12 24.05 L 12.01 24.10 L 13.87 24.17 L 16.00 24.20 L 18.25 24.17 L 19.26 24.13 L 20.20 24.09 L 21.76 23.99 L 22.53 23.91 L 22.97 23.83 L 23.48 23.70 L 24.38 23.43 L 24.93 23.26 L 25.32 23.13 L 25.50 23.06 L 25.73 22.99 L 25.77 22.98 L 25.81 22.98 L 25.86 22.99 L 25.94 23.02 L 26.22 23.13 L 26.25 23.12 L 26.34 23.07 L 26.49 22.96 L 26.80 22.75 L 27.04 22.55 L 27.29 22.34 L 27.60 22.02 L 27.91 21.65 L 28.42 20.88 L 28.62 20.47 L 28.79 20.07 L 28.89 19.76 L 29.00 19.29 L 29.01 19.10 L 29.00 18.72 L 28.95 18.12 L 28.78 17.09 L 28.66 16.60 L 28.53 16.14 L 28.18 15.32 L 27.83 14.73 L 27.06 13.93 L 26.76 13.73 L 26.38 13.53 L 26.12 13.45 L 25.88 13.42 L 25.76 13.41 L 25.69 13.41 L 25.46 13.40 L 25.24 13.40 L 25.13 13.40 L 24.83 13.37 L 24.68 13.31 L 24.59 13.26 L 24.47 13.15 L 24.42 13.08 L 24.39 12.99 L 24.36 12.91 L 24.36 12.87 L 24.37 12.81 L 24.38 12.79 L 24.40 12.77 L 24.42 12.76 L 24.46 12.73 L 24.53 12.71 L 24.74 12.69 L 24.95 12.68 L 25.00 12.68 L 24.71 12.68 L 23.84 12.68 L 22.95 12.68 L 21.90 12.68 L 20.63 12.68 L 19.86 12.69 L 19.09 12.69 L 17.61 12.69 L 17.49 12.69 L 16.00 12.69 L 14.46 12.69 Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      {/* 3. the waterline, running off to starboard with the flow arrow */}
      <path
        d="M 0.7 19.25 L 30.9 19.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M 29.6 18.30 L 31.1 19.25 L 29.6 20.20"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 4. the centreplane, dash-dot, keel to deck */}
      <path
        d="M 16 9.49 L 16 25.90"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeDasharray="1.9 1.2 0.45 1.2"
        opacity="0.85"
      />
      {/* 5. the centre of gravity, in the cockpit opening */}
      <circle cx="16" cy="12.79" r="1.25" fill="currentColor" />
      {/* 6. the centre of buoyancy, in the displaced volume */}
      <circle cx="16" cy="20.95" r="1.15" stroke="currentColor" strokeWidth="1.25" />
      {/* 7. the KB tick on the centreplane */}
      <path
        d="M 14.2 20.98 L 17.8 20.98"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* 8. the BWL dimension, offset below the hull */}
      <path
        d="M 3.00 27.70 L 29.00 27.70"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
      />
      <path
        d="M 3.00 25.20 L 3.00 27.70 M 29.00 25.20 L 29.00 27.70"
        stroke="currentColor"
        strokeWidth="1.05"
        opacity="0.65"
      />
      <path
        d="M 4.60 27.15 L 3.00 27.70 L 4.60 28.25 M 27.40 27.15 L 29.00 27.70 L 27.40 28.25"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 9. the draft dimension, off to port */}
      <path
        d="M 1.6 19.25 L 1.6 24.20"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M 0.6 19.25 L 1.6 19.25 L 0.6 19.95 M 0.6 24.20 L 1.6 24.20 L 0.6 23.50"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
