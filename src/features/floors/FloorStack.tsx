import { playerSize } from '../../model/players.ts'
import type { CellRect, Floor } from '../../model/types.ts'
import { roomRevealed } from '../../model/visibility.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { tokenShown } from '../party/tokenInfo.ts'

const PAD = 4
/** How far each tier sits below the one above, as a share of a plate's height. */
const TIER_STEP = 0.72

/**
 * A thumbnail of every floor as a stacked isometric plate, with its rooms and
 * tokens, so the whole dungeon reads at a glance. `floors` is highest first.
 */
export function FloorStack({
  floors,
  activeId,
  width,
  height,
}: {
  floors: readonly Floor[]
  activeId: string | null
  width: number
  height: number
}) {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const viewMode = useEditorStore((state) => state.viewMode)
  const roomsOf = (floor: Floor) => (viewMode === 'player' ? floor.rooms.filter(roomRevealed) : floor.rooms)

  const rects = floors.flatMap((floor) => roomsOf(floor).map((room) => room.rect))
  const bounds: CellRect =
    rects.length === 0
      ? { minX: 0, minY: 0, maxX: 7, maxY: 7 }
      : {
          minX: Math.min(...rects.map((rect) => rect.minX)),
          minY: Math.min(...rects.map((rect) => rect.minY)),
          maxX: Math.max(...rects.map((rect) => rect.maxX)),
          maxY: Math.max(...rects.map((rect) => rect.maxY)),
        }

  // Iso projection: u runs east-west across the plate, v runs down it.
  const uMin = bounds.minX - (bounds.maxY + 1)
  const uMax = bounds.maxX + 1 - bounds.minY
  const vMin = (bounds.minX + bounds.minY) / 2
  const vMax = (bounds.maxX + bounds.maxY + 2) / 2
  const plateW = uMax - uMin
  const plateH = vMax - vMin
  const tiers = Math.max(1, floors.length)
  const scale = Math.min(
    (width - PAD * 2) / plateW,
    (height - PAD * 2) / (plateH * (1 + (tiers - 1) * TIER_STEP)),
  )
  const step = plateH * scale * TIER_STEP
  const stackH = plateH * scale + (tiers - 1) * step
  const left = (width - plateW * scale) / 2
  const top = (height - stackH) / 2

  function at(x: number, y: number, tier: number): string {
    const px = left + (x - y - uMin) * scale
    const py = top + ((x + y) / 2 - vMin) * scale + tier * step
    return `${px.toFixed(1)},${py.toFixed(1)}`
  }

  function quad(rect: CellRect, tier: number): string {
    return [
      at(rect.minX, rect.minY, tier),
      at(rect.maxX + 1, rect.minY, tier),
      at(rect.maxX + 1, rect.maxY + 1, tier),
      at(rect.minX, rect.maxY + 1, tier),
    ].join(' ')
  }

  // Lowest tier first so the floors above paint over it.
  const drawOrder = floors.map((floor, tier) => ({ floor, tier })).reverse()

  return (
    <svg className="floor-stack" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {drawOrder.map(({ floor, tier }) => {
        const active = floor.id === activeId
        return (
          <g key={floor.id} className={`floor-stack-tier${active ? ' is-active' : ''}`}>
            <polygon className="floor-stack-plate" points={quad(bounds, tier)} />
            {roomsOf(floor).map((room) => (
              <polygon
                key={room.id}
                className={`floor-stack-room${room.visible ? '' : ' is-hidden'}`}
                points={quad(room.rect, tier)}
              />
            ))}
            {tokens
              .filter((token) => token.floorId === floor.id && tokenShown(token, [floor], viewMode))
              .map((token) => {
                const size = playerSize(token)
                const [cx, cy] = at(token.x + size / 2, token.y + size / 2, tier).split(',')
                return (
                  <circle
                    key={token.id}
                    className="floor-stack-token"
                    cx={cx}
                    cy={cy}
                    r={3.2}
                    fill={token.color}
                    fillOpacity={token.visible ? 1 : 0.45}
                  />
                )
              })}
          </g>
        )
      })}
    </svg>
  )
}
