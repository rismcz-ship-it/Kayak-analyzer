import type { ReactNode } from 'react'
import HullMark from './HullMark'

export type TabKey = 'analyze' | 'compare'

interface RailProps {
  tab: TabKey
  onTab: (tab: TabKey) => void
}

interface NavButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  children: ReactNode
}

function NavButton({
  label,
  active = false,
  disabled = false,
  title,
  onClick,
  children,
}: NavButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex h-[52px] w-14 flex-col items-center justify-center gap-1 rounded-lg transition-colors ${
        active ? 'bg-panel text-ink' : 'text-ink-3 hover:bg-panel hover:text-ink-2'
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      <span className={active ? 'text-accent-500' : undefined}>{children}</span>
      <span className="text-[11px]">{label}</span>
    </button>
  )
}

/**
 * The left rail: the app's only navigation. Analyze and Compare are the two
 * surfaces that exist today; Settings is the reserved slot at the foot, kept
 * visibly separate so a third destination can join it without a redesign.
 */
export default function Rail({ tab, onTab }: RailProps) {
  return (
    <nav
      aria-label="Main"
      className="flex w-16 shrink-0 flex-col items-center border-r border-line bg-rail py-4"
    >
      <HullMark className="mb-4 h-[21px] w-[34px] text-ink" />

      <NavButton
        label="Analyze"
        active={tab === 'analyze'}
        onClick={() => onTab('analyze')}
        title="Analyze hydrostatics"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
          <path
            d="M3 18h18M5 18c1.6-7 5.1-11 7-11s5.4 4 7 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </NavButton>

      <NavButton
        label="Compare"
        active={tab === 'compare'}
        onClick={() => onTab('compare')}
        title="Compare two runs"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
          <rect
            x="4"
            y="8"
            width="7"
            height="11"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="13"
            y="5"
            width="7"
            height="11"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </NavButton>

      <div className="mt-auto flex w-10 justify-center border-t border-line pt-2">
        <NavButton label="Settings" disabled title="Settings — not available yet">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle
              cx="9"
              cy="7"
              r="2"
              fill="var(--color-rail)"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="15"
              cy="12"
              r="2"
              fill="var(--color-rail)"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="9"
              cy="17"
              r="2"
              fill="var(--color-rail)"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </NavButton>
      </div>
    </nav>
  )
}
