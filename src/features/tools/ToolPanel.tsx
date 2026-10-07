import { Fragment, useEffect, useRef } from 'react'
import { drawObjectThumb } from '../../canvas/objects.ts'
import { OBJECTS, objectDef, type ObjectDef } from '../../objects/catalog.ts'
import { blankObject, copyObject } from '../../objects/custom.ts'
import { CUSTOM_OBJECTS } from '../objectEditor/ObjectEditor.tsx'
import type { DoorStyle, Tool } from '../../model/tools.ts'
import type { StairsDir } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useObjectLibraryStore } from '../../state/objectLibraryStore.ts'
import { roomsWithOwnTileset, TILESETS, tilesetById } from '../../tiles/sets/index.ts'
import { Icon } from '../../ui/Icon.tsx'

interface ToolDef {
  id: Tool
  label: string
  shortcut: string
  hint: string
  options?: 'doors' | 'stairs' | 'link' | 'objects'
  /** Starts a new group, drawn with a rule before it. */
  group?: boolean
}

const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'H', hint: 'Move rooms and tokens without drawing' },
  { id: 'rooms', label: 'Rooms', shortcut: 'R', hint: 'Drag to paint a room', group: true },
  { id: 'walls', label: 'Walls', shortcut: 'A', hint: 'Drag to add or erase walls' },
  { id: 'doors', label: 'Doors', shortcut: 'D', hint: 'Drag along a wall · Right-click a door to open or close it', options: 'doors' },
  { id: 'windows', label: 'Windows', shortcut: 'W', hint: 'Drag along a wall · Right-click a window to open or close it' },
  { id: 'stairs', label: 'Stairs', shortcut: 'S', hint: 'Drag inside a room to lead up or down a floor', options: 'stairs', group: true },
  { id: 'link', label: 'Link', shortcut: 'L', hint: 'Click two rooms to link them so they move together', options: 'link' },
  {
    id: 'objects',
    label: 'Objects',
    shortcut: 'O',
    hint: 'Click a floor to place · Drag one to move it · T to turn · Right-click for more',
    options: 'objects',
    group: true,
  },
]

const DOOR_STYLES: ReadonlyArray<{ id: DoorStyle; label: string }> = [
  { id: 'door', label: 'Door' },
  { id: 'open', label: 'Archway' },
]

const STAIRS_DIRS: ReadonlyArray<{ id: StairsDir; label: string; title: string }> = [
  { id: 'up', label: 'Up', title: 'Stairs up to the next floor' },
  { id: 'down', label: 'Down', title: 'Stairs down to the floor below' },
  { id: 'both', label: 'Both', title: 'Stairs to the floors above and below' },
]

/** The Stairs tool set to "Between rooms" works as its own tool, with its own hint. */
const BETWEEN_HINT = 'Drag from one room into a higher or lower one to join them with stairs'

/** The Link button set to "Merge" works as its own tool, with its own hint. */
const MERGE_HINT = 'Click two touching rooms to merge them into one · Split it again from its room menu'

export function ToolPanel() {
  const viewMode = useEditorStore((state) => state.viewMode)
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  const roomsLocked = useEditorStore((state) => state.roomsLocked)

  if (viewMode === 'player') return null
  // "Between rooms" is a setting of the Stairs button; "Merge" one of the Link button.
  const shown = tool === 'ramp' ? 'stairs' : tool === 'merge' ? 'link' : tool
  const active = TOOLS.find((item) => item.id === shown)
  const hint =
    tool === 'ramp'
      ? BETWEEN_HINT
      : tool === 'merge'
        ? MERGE_HINT
        : tool === 'select' && roomsLocked
          ? 'Move tokens without drawing · rooms are locked in place'
          : active?.hint

  return (
    <div className="tool-dock">
      <div className="panel tools scroll-h" role="toolbar" aria-label="Tools">
        {TOOLS.map((item) => (
          <Fragment key={item.id}>
            {item.group ? <span className="tool-rule" aria-hidden /> : null}
            <div className="tool-block">
              <button
                type="button"
                className={`tool${item.id === shown ? ' is-active' : ''}`}
                onClick={() => setTool(item.id)}
                aria-pressed={item.id === shown}
                aria-label={`${item.label} (${item.shortcut})`}
                title={`${item.label} (${item.shortcut}) — ${item.hint}`}
              >
                <Icon id={item.id} size={19} />
              </button>
              {item.options === 'doors' ? <DoorOptions /> : null}
              {item.options === 'stairs' ? <StairsOptions /> : null}
              {item.options === 'link' ? <LinkOptions /> : null}
              {item.options === 'objects' ? <ObjectOptions /> : null}
            </div>
          </Fragment>
        ))}
        <span className="tool-rule" aria-hidden />
        <MovementLock />
        <TilesetSelect />
      </div>
      {active ? (
        <p className="tool-hint">
          <strong>{active.label}</strong> · {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Movement lock: while on, dragging a room selects it (and pans) instead of moving it, so play can't shift the map. */
function MovementLock() {
  const locked = useEditorStore((state) => state.roomsLocked)
  const setLocked = useEditorStore((state) => state.setRoomsLocked)
  const label = locked ? 'Movement lock on: rooms stay put' : 'Movement lock off: rooms can be dragged'
  return (
    <button
      type="button"
      className={`tool${locked ? ' is-active' : ''}`}
      onClick={() => setLocked(!locked)}
      aria-pressed={locked}
      aria-label="Movement lock"
      title={`${label} — click to ${locked ? 'unlock' : 'lock'}`}
    >
      <Icon id={locked ? 'lock' : 'unlock'} size={19} />
    </button>
  )
}

/**
 * The look rooms on the map are drawn with; changing it restyles existing rooms
 * too. When some rooms have their own tileset, the DM is asked whether they keep it.
 */
function TilesetSelect() {
  const tileset = useDungeonStore((state) => tilesetById(state.dungeon.tileset))

  function choose(id: string): void {
    const dungeon = useDungeonStore.getState()
    if (roomsWithOwnTileset(dungeon.dungeon, id) > 0) useEditorStore.getState().promptTileset(id)
    else dungeon.setTileset(id)
  }

  return (
    <select
      className="tileset-select"
      value={tileset.id}
      onChange={(event) => choose(event.target.value)}
      aria-label="Tileset"
      title="Tileset — the look of the rooms on the map"
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
  const between = useEditorStore((state) => state.stairsBetween)
  const setStairsDir = useEditorStore((state) => state.setStairsDir)
  const setStairsBetween = useEditorStore((state) => state.setStairsBetween)

  return (
    <ul className="tool-options" aria-label="Where the stairs lead">
      {STAIRS_DIRS.map((option) => {
        const active = !between && option.id === stairsDir
        return (
          <li key={option.id}>
            <button
              type="button"
              className={`tool-option${active ? ' is-active' : ''}`}
              onClick={() => setStairsDir(option.id)}
              aria-pressed={active}
              title={option.title}
            >
              {option.label}
            </button>
          </li>
        )
      })}
      <li>
        <button
          type="button"
          className={`tool-option${between ? ' is-active' : ''}`}
          onClick={setStairsBetween}
          aria-pressed={between}
          title="Stairs joining rooms of different heights on this floor"
        >
          Between rooms
        </button>
      </li>
    </ul>
  )
}

function LinkOptions() {
  const merge = useEditorStore((state) => state.linkMerge)
  const setLinkMerge = useEditorStore((state) => state.setLinkMerge)
  const options = [
    { merge: false, label: 'Link', title: 'Keep the rooms separate but move them together' },
    { merge: true, label: 'Merge', title: 'Combine the rooms into one room of any shape' },
  ]

  return (
    <ul className="tool-options" aria-label="How rooms join">
      {options.map((option) => (
        <li key={option.label}>
          <button
            type="button"
            className={`tool-option${option.merge === merge ? ' is-active' : ''}`}
            onClick={() => setLinkMerge(option.merge)}
            aria-pressed={option.merge === merge}
            title={option.title}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Picker value listing every object rather than one tileset's. */
const ALL_OBJECTS = 'all'

/**
 * The objects to place, sorted by tileset: the map's own look first, or any
 * other look's list, or the whole catalog.
 */
function ObjectOptions() {
  const mapTileset = useDungeonStore((state) => tilesetById(state.dungeon.tileset))
  const group = useEditorStore((state) => state.objectGroup) ?? mapTileset.id
  const kind = useEditorStore((state) => state.objectKind)
  const tool = useEditorStore((state) => state.tool)
  const setObjectKind = useEditorStore((state) => state.setObjectKind)
  const setObjectGroup = useEditorStore((state) => state.setObjectGroup)
  const openObjectEditor = useEditorStore((state) => state.openObjectEditor)
  const customs = useObjectLibraryStore((state) => state.objects)
  const listed: readonly ObjectDef[] =
    group === ALL_OBJECTS
      ? [...OBJECTS, ...customs]
      : group === CUSTOM_OBJECTS
        ? customs
        : tilesetById(group).objects.map(objectDef)
  const custom = customs.find((def) => def.id === kind)
  const builtIn = OBJECTS.find((def) => def.id === kind)

  return (
    <div className="tool-options object-picker" aria-label="Objects">
      <div className="object-picker-head">
        <select
          className="tileset-select"
          value={group}
          onChange={(event) => setObjectGroup(event.target.value === mapTileset.id ? null : event.target.value)}
          aria-label="Which objects to list"
        >
          {TILESETS.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
          <option value={CUSTOM_OBJECTS}>Custom objects</option>
          <option value={ALL_OBJECTS}>All objects</option>
        </select>
      </div>
      {listed.length === 0 && <p className="object-picker-empty">No custom objects yet. Make one with New object.</p>}
      <ul className="object-grid">
        {listed.map((def) => {
          const active = tool === 'objects' && def.id === kind
          return (
            <li key={def.id}>
              <button
                type="button"
                className={`object-choice${active ? ' is-active' : ''}`}
                onClick={() => setObjectKind(def.id)}
                aria-pressed={active}
                title={`${def.name} · ${def.w}×${def.d}`}
              >
                <ObjectThumb def={def} />
                <span>{def.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="object-picker-foot">
        <button type="button" className="gold-btn" onClick={() => openObjectEditor(blankObject())} title="Build a new object out of simple shapes">
          New object
        </button>
        {custom ? (
          <button type="button" className="gold-btn" onClick={() => openObjectEditor(custom)} title={`Change ${custom.name}`}>
            Edit
          </button>
        ) : builtIn ? (
          <button
            type="button"
            className="gold-btn"
            onClick={() => openObjectEditor(copyObject(builtIn))}
            title={`Make a copy of ${builtIn.name} to change`}
          >
            Copy &amp; edit
          </button>
        ) : null}
      </div>
    </div>
  )
}

const THUMB = 52

function ObjectThumb({ def }: { def: ObjectDef }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = THUMB * dpr
    canvas.height = THUMB * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawObjectThumb(ctx, def, THUMB)
  }, [def])
  return <canvas ref={ref} className="object-thumb" width={THUMB} height={THUMB} aria-hidden />
}
