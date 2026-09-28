import { resolveFloor } from '../../model/floors.ts'
import { nextShownFloor } from '../../model/visibility.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'

/** Navigation only — new floors come from placing stairs. */
export function FloorSwitcher() {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const activeFloorId = useEditorStore((state) => state.activeFloorId)
  const viewMode = useEditorStore((state) => state.viewMode)
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor)
  const active = resolveFloor(floors, activeFloorId)
  const above = nextShownFloor(floors, active.order, 1, viewMode)
  const below = nextShownFloor(floors, active.order, -1, viewMode)

  return (
    <div className="floor-switch">
      <button
        type="button"
        onClick={() => above && setActiveFloor(above.id)}
        disabled={!above}
        title={above ? `Go up to ${above.name}` : 'No floor above'}
        aria-label="Go up one floor"
      >
        ▲
      </button>
      <span className="floor-switch-name">{active.name}</span>
      <button
        type="button"
        onClick={() => below && setActiveFloor(below.id)}
        disabled={!below}
        title={below ? `Go down to ${below.name}` : 'No floor below'}
        aria-label="Go down one floor"
      >
        ▼
      </button>
    </div>
  )
}
