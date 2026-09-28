import type { ReactNode, SVGProps } from 'react'

const stroke: Pick<
  SVGProps<SVGPathElement>,
  'fill' | 'stroke' | 'strokeWidth' | 'strokeLinecap' | 'strokeLinejoin'
> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function glyph(id: string): ReactNode {
  switch (id) {
    case 'raise':
      return <path {...stroke} d="M12 19V5M6 11l6-6 6 6" />
    case 'lower':
      return <path {...stroke} d="M12 5v14M6 13l6 6 6-6" />
    case 'rename':
      return <path {...stroke} d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />
    case 'resize':
      return <path {...stroke} d="M10 4H4v6M14 4h6v6M4 14v6h6M20 14v6h-6" />
    case 'delete':
      return (
        <>
          <path {...stroke} d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" />
        </>
      )
    case 'reveal':
    case 'visible':
      return (
        <>
          <path {...stroke} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </>
      )
    case 'hide':
      return (
        <>
          <path {...stroke} d="M3 13c2.8-4 5.8-5.7 9-5.7s6.2 1.7 9 5.7" />
          <path {...stroke} d="M3 13c2.8 1.1 5.8 1.7 9 1.7s6.2-.6 9-1.7" />
          <path {...stroke} d="M12 15.2V18M7.2 14.4 6 16.8M16.8 14.4 18 16.8" />
        </>
      )
    case 'open':
      return (
        <>
          <path {...stroke} d="M6 4h8v16H6z" />
          <path {...stroke} d="M14 4l6 3v10l-6 3" />
        </>
      )
    case 'close':
      return (
        <>
          <path {...stroke} d="M7 4h10v16H7z" />
          <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )
    case 'grow':
      return (
        <>
          <path {...stroke} d="M8 8h8v8H8z" />
          <path {...stroke} d="M12 4v3M12 17v3M4 12h3M17 12h3" />
        </>
      )
    case 'shrink':
      return (
        <>
          <path {...stroke} d="M8 8h8v8H8z" />
          <path {...stroke} d="M12 6v4M12 14v4M6 12h4M14 12h4" />
        </>
      )
    case 'status':
      return (
        <>
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path {...stroke} d="M12 8v5M12 16.5v.5" />
        </>
      )
    case 'hand':
      return (
        <>
          <path {...stroke} d="M8 11V6.2a1.3 1.3 0 0 1 2.6 0V11" />
          <path {...stroke} d="M10.6 10.4V5a1.3 1.3 0 0 1 2.6 0V11" />
          <path {...stroke} d="M13.2 10.6V6.4a1.3 1.3 0 1 1 2.6 0V12" />
          <path {...stroke} d="M8 11.4v2.4c0 2.5 1.9 4.4 4.3 4.4h.7c1.9 0 3.4-1 4.2-2.4" />
          <path {...stroke} d="M8 13.6 5.7 12.4" />
        </>
      )
    default:
      return null
  }
}

export function SliceIcon({ id }: { id: string }) {
  return (
    <g className="radial-icon" pointerEvents="none">
      {glyph(id)}
    </g>
  )
}

export function MenuIcon({ id, size = 14 }: { id: string; size?: number }) {
  return (
    <svg
      className="menu-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      {glyph(id)}
    </svg>
  )
}
