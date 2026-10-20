import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useWorldStore } from '../../state/worldStore.ts'
import { Icon } from '../../ui/Icon.tsx'

/**
 * Up from the battle map to the world map one of whose pins leads here (the first,
 * if several do). Nothing at all when none does, or for players, whose world maps
 * are only the one the DM shows them.
 */
export function WorldMapButton() {
  const host = useSessionStore((state) => state.role === 'host')
  const liveMapId = useNotesStore((state) => state.mapId)
  const world = useWorldStore((state) =>
    liveMapId ? state.worlds.find((item) => item.pins.some((pin) => pin.mapId === liveMapId)) : undefined,
  )
  if (!host || !world) return null
  return (
    <button
      type="button"
      className="icon-btn floor-world-btn"
      aria-label={`Open world map ${world.name}`}
      title={`Open world map: ${world.name}`}
      onClick={() => useWorldStore.getState().view(world.id)}
    >
      <Icon id="world" size={17} />
    </button>
  )
}
