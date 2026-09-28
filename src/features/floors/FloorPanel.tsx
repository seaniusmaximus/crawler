import { useState, type MouseEvent } from 'react'
import { SessionPanel } from '../session/SessionPanel.tsx'
import { PartyList } from '../party/PartyList.tsx'
import { DiceTray } from '../dice/DiceTray.tsx'
import { floorsTopDown, GROUND_ORDER } from '../../model/floors.ts'
import { characterNameOf, playersInRoom } from '../../model/players.ts'
import { rectHeight, rectWidth } from '../../model/rect.ts'
import type { Floor, Room } from '../../model/types.ts'
import { roomRevealed, shownFloors, tokenRevealed } from '../../model/visibility.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { MenuIcon } from '../menus/radialIcons.tsx'

export const PANEL_WIDTH = 260

export function FloorPanel() {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const setHoverRoom = useEditorStore((state) => state.setHoverRoom)
  const listed = shownFloors(floors, viewMode)

  function toggleFloor(floorId: string): void {
    setCollapsed((current) => ({ ...current, [floorId]: !current[floorId] }))
  }

  return (
    <aside
      className="flyout"
      style={{ width: PANEL_WIDTH }}
      onPointerLeave={() => setHoverRoom(null)}
    >
      <div className="flyout-body">
        <SessionPanel />
        <PartyList leftInset={PANEL_WIDTH} />
        {listed.length === 0 ? (
          <p className="floor-empty">No revealed rooms</p>
        ) : (
          floorsTopDown(listed).map((floor) => (
            <FloorSection
              key={floor.id}
              floor={floor}
              collapsed={Boolean(collapsed[floor.id])}
              onToggle={() => toggleFloor(floor.id)}
            />
          ))
        )}
      </div>
      <DiceTray />
    </aside>
  )
}

function FloorSection({
  floor,
  collapsed,
  onToggle,
}: {
  floor: Floor
  collapsed: boolean
  onToggle: () => void
}) {
  const viewMode = useEditorStore((state) => state.viewMode)
  const rooms = viewMode === 'player' ? floor.rooms.filter(roomRevealed) : floor.rooms
  const active = useEditorStore(
    (state) =>
      state.activeFloorId === floor.id ||
      (state.activeFloorId === null && floor.order === GROUND_ORDER),
  )
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor)

  return (
    <fieldset className={`floor${active ? ' is-active' : ''}`}>
      <legend className="floor-head">
        <button type="button" className="floor-name" onClick={() => setActiveFloor(floor.id)}>
          {floor.name}
        </button>
        <button
          type="button"
          className={`floor-caret${collapsed ? ' is-collapsed' : ''}`}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${floor.name}` : `Collapse ${floor.name}`}
        >
          ▾
        </button>
        <span className="floor-count">
          {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
        </span>
      </legend>
      {collapsed ? null : (
        <ul className="room-list">
          {rooms.length === 0 ? (
            <li className="room-empty">
              {viewMode === 'player' ? 'Nothing revealed on this floor' : 'Drag on the grid to paint a room'}
            </li>
          ) : (
            rooms.map((room) => <RoomRow key={room.id} floor={floor} room={room} />)
          )}
        </ul>
      )}
    </fieldset>
  )
}

function RoomRow({ floor, room }: { floor: Floor; room: Room }) {
  const viewMode = useEditorStore((state) => state.viewMode)
  const selected = useEditorStore(
    (state) => viewMode !== 'player' && state.selectedRoomId === room.id,
  )
  const hovered = useEditorStore(
    (state) => viewMode !== 'player' && state.hoverRoomId === room.id,
  )
  const setHoverRoom = useEditorStore((state) => state.setHoverRoom)
  const focusRoom = useEditorStore((state) => state.focusRoom)
  const players = useDungeonStore((state) => state.dungeon.players ?? [])
  const occupants = playersInRoom(players, floor, room.id).filter(
    (player) => viewMode !== 'player' || tokenRevealed(player),
  )
  const stairCount = room.stairs.length
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(room.name)

  function nudge(delta: number, event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    event.preventDefault()
    useDungeonStore.getState().nudgeRoomElevation(floor.id, room.id, delta)
  }

  function removeRoom(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    event.preventDefault()
    const orphans = useDungeonStore.getState().deleteRoom(floor.id, room.id)
    const editor = useEditorStore.getState()
    if (editor.selectedRoomId === room.id) editor.selectRoom(null)
    if (editor.hoverRoomId === room.id) editor.setHoverRoom(null)
    if (orphans.length > 0) editor.promptStairLandings(orphans)
  }

  function commitName(): void {
    const trimmed = draft.trim()
    if (trimmed) useDungeonStore.getState().renameRoom(floor.id, room.id, draft)
    else setDraft(room.name)
    setEditing(false)
  }

  return (
    <li
      className={`room-item${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${
        room.visible ? '' : ' is-hidden'
      }`}
      onPointerEnter={() => {
        if (viewMode === 'player') return
        setHoverRoom(room.id)
      }}
    >
      {editing && viewMode !== 'player' ? (
        <input
          className="room-name-input"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitName()
            if (event.key === 'Escape') {
              setDraft(room.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="room-row"
          onFocus={() => {
            if (viewMode === 'player') return
            setHoverRoom(room.id)
          }}
          onClick={() => focusRoom(floor.id, room.id, PANEL_WIDTH)}
          onDoubleClick={() => {
            if (viewMode === 'player') return
            setDraft(room.name)
            setEditing(true)
          }}
        >
          <span className="room-name">{room.name}</span>
          <span className="room-meta">
            {stairCount > 0 ? (
              <span className="room-stairs" title={`${stairCount} stairs`}>
                ⇅
              </span>
            ) : null}
            <span className="room-size">
              {rectWidth(room.rect)}×{rectHeight(room.rect)}
            </span>
          </span>
          {occupants.length > 0 ? (
            <span className="room-pips">
              {occupants.map((player) => (
                <span
                  key={player.id}
                  className="room-pip"
                  title={`${characterNameOf(player)} (${player.name})`}
                  style={{ background: player.color }}
                />
              ))}
            </span>
          ) : null}
        </button>
      )}
      {viewMode === 'player' ? null : (
        <div className="room-tools">
          <div className="room-elev">
            <div className="room-elev-stack">
              <button
                type="button"
                className="room-elev-btn"
                aria-label={`Raise ${room.name}`}
                title="Raise (+)"
                onClick={(event) => nudge(1, event)}
              >
                +
              </button>
              <button
                type="button"
                className="room-elev-btn"
                aria-label={`Lower ${room.name}`}
                title="Lower (–)"
                onClick={(event) => nudge(-1, event)}
              >
                −
              </button>
            </div>
            <span className={`room-elev-value${(room.elevation ?? 0) !== 0 ? ' is-raised' : ''}`}>
              {room.elevation ?? 0}
            </span>
          </div>
          <button
            type="button"
            className={`icon-btn${room.visible ? ' is-on' : ''}`}
            aria-pressed={room.visible}
            aria-label={room.visible ? `Hide ${room.name} from players` : `Reveal ${room.name} to players`}
            title={room.visible ? 'Visible to players' : 'Hidden from players'}
            onClick={(event) => {
              event.stopPropagation()
              useDungeonStore.getState().setRoomVisible(floor.id, room.id, !room.visible)
            }}
          >
            <MenuIcon id={room.visible ? 'reveal' : 'hide'} />
          </button>
          <button
            type="button"
            className="icon-btn is-danger"
            aria-label={`Delete ${room.name}`}
            title="Delete room"
            onClick={removeRoom}
          >
            <MenuIcon id="delete" />
          </button>
        </div>
      )}
    </li>
  )
}
