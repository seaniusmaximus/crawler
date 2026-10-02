import type { ReactNode } from 'react'

/** Stroke icons drawn on a 24px grid, coloured by `currentColor`. */
const PATHS: Record<string, ReactNode> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  rooms: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 12h6M14 12h6" strokeDasharray="2 2" />
    </>
  ),
  walls: <path d="M3 6h18v12H3zM3 12h18M9 6v6M15 12v6" />,
  doors: (
    <>
      <path d="M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M3 21h18" />
      <circle cx="14.5" cy="12.5" r="0.8" fill="currentColor" />
    </>
  ),
  windows: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 4v16M4 12h16" />
    </>
  ),
  stairs: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  ramp: <path d="M3 20h18L21 6z" />,
  link: (
    <>
      <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66L12 6.3" />
      <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.7 2.8L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M21 12a9 9 0 11-9-9 9.5 9.5 0 016.7 2.8L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  nextTurn: <path d="M6 5l7 7-7 7M15 5v14" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A17 17 0 002 12s3.6 7 10 7a9.7 9.7 0 005.4-1.6" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  share: <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13" />,
  save: <path d="M6 4h10l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM8 4v5h7V4M8 20v-6h8v6" />,
  download: <path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4M8 10l4 4 4-4M12 14V3" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" />,
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  resize: <path d="M10 4H4v6M14 4h6v6M4 14v6h6M20 14v6h-6" />,
  look: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  doorOpen: <path d="M4 21h16M6 21V4l8-1v18M14 5h4v16M11 12v.5" />,
  d4: <path d="M12 3L21 20H3z" />,
  d6: <rect x="4" y="4" width="16" height="16" rx="2" />,
  d8: <path d="M12 2L21 12 12 22 3 12zM3 12h18" />,
  d10: <path d="M12 2L21 10 12 22 3 10zM3 10l9 4 9-4M12 14v8" />,
  d12: (
    <>
      <path d="M12 2l9 6.5-3.4 11H6.4L3 8.5z" />
      <path d="M12 7l4.5 3.2-1.7 5.3H9.2l-1.7-5.3z" />
    </>
  ),
  d20: (
    <>
      <path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" />
      <path d="M12 2L7 11h10z M7 11l5 11 5-11M3.34 7L7 11M20.66 7L17 11M3.34 17L7 11M20.66 17L17 11" />
    </>
  ),
  d100: (
    <>
      <circle cx="8" cy="12" r="5" />
      <circle cx="17" cy="12" r="5" />
    </>
  ),
}

export function Icon({
  id,
  size = 16,
  strokeWidth = 1.6,
  className,
}: {
  id: string
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[id] ?? null}
    </svg>
  )
}

/** The small diamond that marks panel titles and dividers. */
export function Diamond({ size = 6 }: { size?: number }) {
  return (
    <svg className="diamond" width={size} height={size} viewBox="0 0 10 10" aria-hidden focusable="false">
      <path d="M5 0L10 5 5 10 0 5z" fill="currentColor" />
    </svg>
  )
}

/** A thin rule broken by a diamond, used between panel sections. */
export function Divider({ tone }: { tone?: 'foe' }) {
  return (
    <div className={`divider${tone ? ` is-${tone}` : ''}`} aria-hidden>
      <span />
      <Diamond />
      <span />
    </div>
  )
}
