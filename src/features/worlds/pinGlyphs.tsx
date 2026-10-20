import type { ReactNode } from 'react'
import type { PinGlyph } from '../../model/worlds.ts'

/** Glyphs for a pin's head, on the same 24px grid as the icons. */
export const PIN_GLYPH_PATHS: Record<PinGlyph, ReactNode> = {
  dot: <circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" />,
  town: <path d="M6 18.5v-7l6-5 6 5v7zM10.5 18.5v-4h3v4" />,
  castle: <path d="M5 19V8.5h3v2h2.5v-2h3v2H16v-2h3V19zM10.5 19v-3.5a1.5 1.5 0 013 0V19" />,
  dungeon: <path d="M5.5 19v-7a6.5 6.5 0 0113 0v7zM9.5 19v-6a2.5 2.5 0 015 0v6" />,
  camp: <path d="M3.5 19L12 5l8.5 14zM9 19l3-5.5 3 5.5" />,
  danger: <path d="M12 4.5l8.5 15h-17zM12 10v4.5M12 17v.4" />,
  star: <path d="M12 4.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" />,
}
