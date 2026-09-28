import { linkSpots } from '../model/links.ts'
import type { Camera, Link, Room } from '../model/types.ts'
import { TILE_HEIGHT, WALL_HEIGHT, cellCenter, lift, roomLift } from './camera.ts'

export interface LinkBadge {
  link: Link
  x: number
  y: number
  radius: number
}

const MIN_RADIUS = 7
const MAX_RADIUS = 13
const GRAB_SLOP = 3

/** Where each live link's badge sits on screen: above the wall tile's diamond. */
export function linkBadges(
  rooms: readonly Room[],
  links: readonly Link[],
  camera: Camera,
): LinkBadge[] {
  const size = TILE_HEIGHT * camera.zoom
  const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, size * 0.35))
  return linkSpots(rooms, links).map((spot) => {
    const a = rooms.find((room) => room.id === spot.link.a)
    const b = rooms.find((room) => room.id === spot.link.b)
    const elevation = Math.max(a?.elevation ?? 0, b?.elevation ?? 0)
    const pos = lift(
      cellCenter(spot.cell.x, spot.cell.y, camera),
      camera,
      roomLift(elevation) + WALL_HEIGHT + 6,
    )
    return { link: spot.link, x: pos.x, y: pos.y, radius }
  })
}

export function hitLinkBadge(
  badges: readonly LinkBadge[],
  sx: number,
  sy: number,
): LinkBadge | null {
  for (const badge of badges) {
    if (Math.hypot(sx - badge.x, sy - badge.y) <= badge.radius + GRAB_SLOP) return badge
  }
  return null
}
