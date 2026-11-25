/**
 * The one toggle on screen: a 28 x 16 track with a 12 px knob.
 *
 * Purely decorative — the button that owns the toggle carries the role and
 * the state, so this never becomes a second interactive control.
 */
export default function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-4 w-7 flex-none rounded-full transition-colors ${
        checked ? 'bg-accent-500' : 'bg-line-2'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-[#f2f6f9] transition-transform ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </span>
  )
}
