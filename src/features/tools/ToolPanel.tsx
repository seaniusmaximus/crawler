import { Fragment } from 'react'
import type { DoorStyle, Tool } from '../../model/tools.ts'
import type { StairsDir } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { TILESETS, tilesetById } from '../../tiles/sets/index.ts'
import { Icon } from '../../ui/Icon.tsx'

interface ToolDef {
  id: Tool
  label: string
  shortcut: string
  hint: string
  options?: 'doors' | 'stairs'
  /** Starts a new group, drawn with a rule before it. */
  group?: boolean
}

const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'H', hint: 'Move rooms and tokens without drawing' },
  { id: 'rooms', label: 'Rooms', shortcut: 'R', hint: 'Drag to paint a room', group: true },
  { id: 'walls', label: 'Walls', shortcut: 'A', hint: 'Drag to add or erase walls' },
  { id: 'doors', label: 'Doors', shortcut: 'D', hint: 'Drag along a wall · Right-click a door to open or close it', options: 'doors' },
  { id: 'windows', label: 'Windows', shortcut: 'W', hint: 'Drag along a wall · Right-click a window to open or close it' },
  { id: 'stairs', label: 'Stairs', shortcut: 'S', hint: 'Drag to link dungeon floors', options: 'stairs', group: true },
  { id: 'ramp', label: 'Ramp', shortcut: 'C', hint: 'Drag between rooms to step elevation' },
  { id: 'link', label: 'Link', shortcut: 'L', hint: 'Click two rooms to link them' },
]

const DOOR_STYLES: ReadonlyArray<{ id: DoorStyle; label: string }> = [
  { id: 'door', label: 'Door' },
  { id: 'open', label: 'Archway' },
]

const STAIRS_DIRS: ReadonlyArray<{ id: StairsDir; label: string }> = [
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
  { id: 'both', label: 'Both' },
]

export function ToolPanel() {
  const viewMode = useEditorStore((state) => state.viewMode)
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)

  if (viewMode === 'player') return null
  const active = TOOLS.find((item) => item.id === tool)

  return (
    <div className="tool-dock">
      <div className="panel tools" role="toolbar" aria-label="Tools">
        {TOOLS.map((item) => (
          <Fragment key={item.id}>
            {item.group ? <span className="tool-rule" aria-hidden /> : null}
            <div className="tool-block">
              <button
                type="button"
                className={`tool${item.id === tool ? ' is-active' : ''}`}
                onClick={() => setTool(item.id)}
                aria-pressed={item.id === tool}
                aria-label={`${item.label} (${item.shortcut})`}
                title={`${item.label} (${item.shortcut}) — ${item.hint}`}
              >
                <Icon id={item.id} size={19} />
              </button>
              {item.options === 'doors' ? <DoorOptions /> : null}
              {item.options === 'stairs' ? <StairsOptions /> : null}
            </div>
          </Fragment>
        ))}
        <span className="tool-rule" aria-hidden />
        <TilesetSelect />
      </div>
      {active ? (
        <p className="tool-hint">
          <strong>{active.label}</strong> · {active.hint}
        </p>
      ) : null}
    </div>
  )
}

/** The look every room on the map is drawn with; changing it restyles existing rooms too. */
function TilesetSelect() {
  const tileset = useDungeonStore((state) => tilesetById(state.dungeon.tileset))
  const setTileset = useDungeonStore((state) => state.setTileset)

  return (
    <select
      className="tileset-select"
      value={tileset.id}
      onChange={(event) => setTileset(event.target.value)}
      aria-label="Tileset"
      title="Tileset — the look of every room on the map"
    >
      {TILESETS.map((set) => (
        <option key={set.id} value={set.id}>
          {set.name}
        </option>
      ))}
    </select>
  )
}

function DoorOptions() {
  const doorStyle = useEditorStore((state) => state.doorStyle)
  const setDoorStyle = useEditorStore((state) => state.setDoorStyle)

  return (
    <ul className="tool-options" aria-label="Door style">
      {DOOR_STYLES.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`tool-option${option.id === doorStyle ? ' is-active' : ''}`}
            onClick={() => setDoorStyle(option.id)}
            aria-pressed={option.id === doorStyle}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

function StairsOptions() {
  const stairsDir = useEditorStore((state) => state.stairsDir)
  const setStairsDir = useEditorStore((state) => state.setStairsDir)

  return (
    <ul className="tool-options" aria-label="Stairs direction">
      {STAIRS_DIRS.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`tool-option${option.id === stairsDir ? ' is-active' : ''}`}
            onClick={() => setStairsDir(option.id)}
            aria-pressed={option.id === stairsDir}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
