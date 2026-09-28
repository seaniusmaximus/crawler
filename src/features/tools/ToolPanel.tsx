import type { DoorStyle, Tool } from '../../model/tools.ts'
import type { StairsDir } from '../../model/types.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { MenuIcon } from '../menus/radialIcons.tsx'

interface ToolDef {
  id: Tool
  label: string
  glyph?: string
  icon?: string
  shortcut: string
  hint: string
  options?: 'doors' | 'stairs'
}

const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', icon: 'hand', shortcut: 'H', hint: 'Move rooms and tokens without drawing' },
  { id: 'rooms', label: 'Rooms', glyph: '▭', shortcut: 'R', hint: 'Drag to paint a room' },
  { id: 'walls', label: 'Walls', glyph: '▣', shortcut: 'A', hint: 'Drag to add or erase walls' },
  { id: 'doors', label: 'Doors', glyph: '◫', shortcut: 'D', hint: 'Drag along a wall · Right-click a door to open or close it', options: 'doors' },
  { id: 'windows', label: 'Windows', glyph: '⊟', shortcut: 'W', hint: 'Drag along a wall · Right-click a window to open or close it' },
  { id: 'stairs', label: 'Stairs', glyph: '⇅', shortcut: 'S', hint: 'Drag to link dungeon floors', options: 'stairs' },
  { id: 'ramp', label: 'Ramp', glyph: '⇗', shortcut: 'C', hint: 'Drag between rooms to step elevation' },
  { id: 'link', label: 'Link', glyph: '☍', shortcut: 'L', hint: 'Click two rooms to link them' },
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

  return (
    <aside className="tools" aria-label="Tools">
      {TOOLS.map((item) => (
        <div key={item.id} className={`tool-block${item.id === tool ? ' is-active' : ''}`}>
          <button
            type="button"
            className={`tool${item.id === tool ? ' is-active' : ''}`}
            onClick={() => setTool(item.id)}
            aria-pressed={item.id === tool}
            title={`${item.label} (${item.shortcut}) — ${item.hint}`}
          >
            <span className="tool-glyph" aria-hidden="true">
              {item.icon ? <MenuIcon id={item.icon} /> : item.glyph}
            </span>
            <span className="tool-label">{item.label}</span>
            <span className="tool-key">{item.shortcut}</span>
            {item.options ? (
              <span className="tool-more" aria-hidden="true">
                ▾
              </span>
            ) : null}
          </button>
          {item.options === 'doors' ? <DoorOptions /> : null}
          {item.options === 'stairs' ? <StairsOptions /> : null}
        </div>
      ))}
    </aside>
  )
}

function DoorOptions() {
  const doorStyle = useEditorStore((state) => state.doorStyle)
  const setDoorStyle = useEditorStore((state) => state.setDoorStyle)
  const setTool = useEditorStore((state) => state.setTool)

  return (
    <ul className="tool-options" aria-label="Door style">
      {DOOR_STYLES.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`tool-option${option.id === doorStyle ? ' is-active' : ''}`}
            onClick={() => {
              setTool('doors')
              setDoorStyle(option.id)
            }}
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
  const setTool = useEditorStore((state) => state.setTool)

  return (
    <ul className="tool-options" aria-label="Stairs direction">
      {STAIRS_DIRS.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`tool-option${option.id === stairsDir ? ' is-active' : ''}`}
            onClick={() => {
              setTool('stairs')
              setStairsDir(option.id)
            }}
            aria-pressed={option.id === stairsDir}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
