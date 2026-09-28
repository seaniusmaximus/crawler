/** 0° is 12 o'clock, clockwise, matching a clock face. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function outward(deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: Math.cos(rad), y: Math.sin(rad) }
}

/** Clockwise around the pie — perpendicular to the outward radial. */
function clockwise(deg: number): { x: number; y: number } {
  const u = outward(deg)
  return { x: -u.y, y: u.x }
}

function corner(
  cx: number,
  cy: number,
  radius: number,
  edgeDeg: number,
  inset: number,
  intoSlice: 1 | -1,
): { x: number; y: number } {
  const u = outward(edgeDeg)
  const t = clockwise(edgeDeg)
  const along = Math.sqrt(Math.max(0, radius * radius - inset * inset))
  return {
    x: cx + along * u.x + intoSlice * inset * t.x,
    y: cy + along * u.y + intoSlice * inset * t.y,
  }
}

function clockwiseSpan(from: { x: number; y: number }, to: { x: number; y: number }, cx: number, cy: number): number {
  const a0 = Math.atan2(from.y - cy, from.x - cx)
  const a1 = Math.atan2(to.y - cy, to.x - cx)
  let span = ((a1 - a0) * 180) / Math.PI
  if (span < 0) span += 360
  return span
}

function arc(radius: number, to: { x: number; y: number }, spanDeg: number, clockwiseSweep: boolean): string {
  const large = spanDeg > 180 ? 1 : 0
  return `A ${fmt(radius)} ${fmt(radius)} 0 ${large} ${clockwiseSweep ? 1 : 0} ${fmt(to.x)} ${fmt(to.y)}`
}

/**
 * Annular slice whose black gutters are a constant pixel width — the radial
 * sides are parallel offsets, not tapered angle cuts.
 */
export function wedgePath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  start: number,
  sweep: number,
  gutter: number,
): string {
  const inset = gutter / 2
  const inner = r0 + inset
  const outer = r1 - inset
  if (outer <= inner || inner <= inset) return ''
  const end = start + sweep
  const outer0 = corner(cx, cy, outer, start, inset, 1)
  const outer1 = corner(cx, cy, outer, end, inset, -1)
  const inner1 = corner(cx, cy, inner, end, inset, -1)
  const inner0 = corner(cx, cy, inner, start, inset, 1)
  const outerSpan = clockwiseSpan(outer0, outer1, cx, cy)
  const innerSpan = clockwiseSpan(inner0, inner1, cx, cy)
  return [
    `M ${fmt(outer0.x)} ${fmt(outer0.y)}`,
    arc(outer, outer1, outerSpan, true),
    `L ${fmt(inner1.x)} ${fmt(inner1.y)}`,
    arc(inner, inner0, innerSpan, false),
    'Z',
  ].join(' ')
}
