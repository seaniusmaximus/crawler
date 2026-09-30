import { useState, type MouseEvent } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { floorTag, floorsTopDown, GROUND_ORDER } from '../../model/floors.ts'
import { playersInRoom } from '../../model/players.ts'
import { rectHeight, rectWidth } from '../../model/rect.ts'
import type { Floor, Player, Room } from '../../model/types.ts'
import { roomRevealed, shownFloors, type ViewMode } from '../../model/visibility.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Diamond, Divider, Icon } from '../../ui/Icon.tsx'
import { tokenShown } from '../party/tokenInfo.ts'
import { FloorStack } from './FloorStack.tsx'

const CHIPS_SHOWN = 2

/** One plate needs little room; each floor above or below adds a tier. */
function stackHeight(floors: number, max: number): number {
  return Math.min(max, 64 + Math.max(0, floors - 1) * 34)
}

function useActiveFloorId(floors: readonly Floor[]): string | null {
  const activeFloorId = useEditorStore((state) => state.activeFloorId)
  if (activeFloorId && floors.some((floor) => floor.id === activeFloorId)) return activeFloorId
  return floors.find((floor) => floor.order === GROUND_ORDER)?.id ?? floors[0]?.id ?? null
}

function shownRoomsOf(floor: Floor, mode: ViewMode): Room[] {
  return mode === 'player' ? floor.rooms.filter(roomRevealed) : floor.rooms
}

function occupantsOf(floor: Floor, room: Room, tokens: readonly Player[], mode: ViewMode): Player[] {
  return playersInRoom(tokens, floor, room.id).filter((token) =>
    tokenShown(token, [floor], mode),
  )
}

/** The floor stack docked bottom-centre; it opens into the floors and rooms drawer. */
export function FloorDock() {
  const [open, setOpen] = useState(false)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  const setHoverRoom = useEditorStore((state) => state.setHoverRoom)
  const listed = floorsTopDown(shownFloors(floors, viewMode))
  const activeId = useActiveFloorId(listed)

  return (
    <div className="floor-dock" onPointerLeave={() => setHoverRoom(null)}>
      {open ? (
        <FloorDrawer floors={listed} activeId={activeId} onCollapse={() => setOpen(false)} />
      ) : (
        <FloorTower floors={listed} activeId={activeId} onExpand={() => setOpen(true)} />
      )}
    </div>
  )
}

function FloorTower({
  floors,
  activeId,
  onExpand,
}: {
  floors: Floor[]
  activeId: string | null
  onExpand: () => void
}) {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const viewMode = useEditorStore((state) => state.viewMode)
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor)

  return (
    <section className="panel floor-tower" aria-label="Floors">
      <FloorStack floors={floors} activeId={activeId} width={140} height={stackHeight(floors.length, 132)} />
      {floors.length === 0 ? (
        <p className="panel-empty">No revealed rooms</p>
      ) : (
        <div className="floor-tower-list">
          {floors.map((floor) => {
            const active = floor.id === activeId
            const busy = shownRoomsOf(floor, viewMode)
              .map((room) => ({ room, people: occupantsOf(floor, room, tokens, viewMode) }))
              .filter((entry) => entry.people.length > 0)
            return (
              <button
                key={floor.id}
                type="button"
                className={`floor-pick${active ? ' is-active' : ''}`}
                aria-pressed={active}
                aria-label={`View ${floorTag(floor.order)}, ${floor.name}`}
                onClick={() => setActiveFloor(floor.id)}
              >
                <span className="floor-tag">{floorTag(floor.order)}</span>
                <span className="floor-pick-name">{floor.name}</span>
                <span className="floor-pick-rooms">
                  {busy.length === 0 ? (
                    <span className="floor-quiet">No one here</span>
                  ) : (
                    <>
                      {busy.slice(0, CHIPS_SHOWN).map(({ room, people }) => (
                        <span key={room.id} className="room-chip">
                          <span>{room.name}</span>
                          <span className="avatar-row">
                            {people.map((person) => (
                              <Avatar key={person.id} player={person} size={20} />
                            ))}
                          </span>
                        </span>
                      ))}
                      {busy.length > CHIPS_SHOWN ? (
                        <span className="floor-quiet">+{busy.length - CHIPS_SHOWN}</span>
                      ) : null}
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="floor-tower-tools">
        <button
          type="button"
          className="icon-btn"
          onClick={onExpand}
          aria-label="Open floors and rooms"
          title="Open floors and rooms"
        >
          <Icon id="chevronUp" size={17} />
        </button>
      </div>
    </section>
  )
}

function FloorDrawer({
  floors,
  activeId,
  onCollapse,
}: {
  floors: Floor[]
  activeId: string | null
  onCollapse: () => void
}) {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const viewMode = useEditorStore((state) => state.viewMode)
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor)
  const active = floors.find((floor) => floor.id === activeId)
  const rooms = active ? shownRoomsOf(active, viewMode) : []
  const hidden = active ? active.rooms.filter((room) => !room.visible).length : 0

  return (
    <section className="panel floor-drawer" aria-label="Floors and rooms">
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Floors</span>
        </h2>
        <button
          type="button"
          className="icon-btn is-boxed"
          onClick={onCollapse}
          aria-label="Collapse floors"
          title="Collapse"
        >
          <Icon id="chevronDown" />
        </button>
      </header>

      <div className="floor-drawer-stack">
        <FloorStack floors={floors} activeId={activeId} width={100} height={stackHeight(floors.length, 136)} />
        <div className="floor-drawer-list">
          {floors.map((floor, index) => {
            const on = floor.id === activeId
            const count = shownRoomsOf(floor, viewMode).length
            const people = tokens.filter(
              (token) => token.floorId === floor.id && tokenShown(token, floors, viewMode),
            )
            return (
              <div key={floor.id} className="floor-drawer-item">
                {index > 0 ? <span className="floor-link" aria-hidden /> : null}
                <button
                  type="button"
                  className={`floor-row${on ? ' is-active' : ''}`}
                  aria-pressed={on}
                  onClick={() => setActiveFloor(floor.id)}
                >
                  <span className="floor-tag">{floorTag(floor.order)}</span>
                  <span className="floor-row-copy">
                    <span>{floor.name}</span>
                    <small>
                      {count} {count === 1 ? 'room' : 'rooms'}
                    </small>
                  </span>
                  <span className="avatar-row">
                    {people.map((person) => (
                      <Avatar key={person.id} player={person} size={18} dim={person.visible !== true} />
                    ))}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {active ? (
        <>
          <Divider />
          <div className="rooms-head">
            <span className="kicker">Rooms on {floorTag(active.order)}</span>
            {viewMode === 'player' ? null : (
              <span className="panel-meta">
                {active.rooms.length - hidden} revealed · {hidden} hidden
              </span>
            )}
          </div>
          <ul className="room-list">
            {rooms.length === 0 ? (
              <li className="panel-empty">
                {viewMode === 'player' ? 'Nothing revealed on this floor' : 'Drag on the grid to paint a room'}
              </li>
            ) : (
              rooms.map((room) => (
                <RoomRow key={room.id} floor={active} room={room} occupants={occupantsOf(active, room, tokens, viewMode)} />
              ))
            )}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function RoomRow({ floor, room, occupants }: { floor: Floor; room: Room; occupants: Player[] }) {
  const viewMode = useEditorStore((state) => state.viewMode)
  const dm = viewMode !== 'player'
  const selected = useEditorStore((state) => dm && state.selectedRoomId === room.id)
  const hovered = useEditorStore((state) => dm && state.hoverRoomId === room.id)
  const setHoverRoom = useEditorStore((state) => state.setHoverRoom)
  const focusRoom = useEditorStore((state) => state.focusRoom)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(room.name)
  const elevation = room.elevation ?? 0

  function nudge(delta: number, event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    useDungeonStore.getState().nudgeRoomElevation(floor.id, room.id, delta)
  }

  function removeRoom(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    const orphans = useDungeonStore.getState().deleteRoom(floor.id, room.id)
    const editor = useEditorStore.getState()
    if (editor.selectedRoomId === room.id) editor.selectRoom(null)
    if (editor.hoverRoomId === room.id) editor.setHoverRoom(null)
    if (orphans.length > 0) editor.promptStairLandings(orphans)
  }

  function commitName(): void {
    if (draft.trim()) useDungeonStore.getState().renameRoom(floor.id, room.id, draft)
    else setDraft(room.name)
    setEditing(false)
  }

  return (
    <li
      className={`room-item${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${
        room.visible ? '' : ' is-hidden'
      }`}
      onPointerEnter={() => dm && setHoverRoom(room.id)}
    >
      {editing && dm ? (
        <input
          className="name-input is-room"
          value={draft}
          autoFocus
          aria-label="Room name"
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
          title={dm ? 'Click to focus · double-click to rename' : 'Focus this room'}
          onFocus={() => dm && setHoverRoom(room.id)}
          onClick={() => focusRoom(floor.id, room.id, FOCUS_INSET)}
          onDoubleClick={() => {
            if (!dm) return
            setDraft(room.name)
            setEditing(true)
          }}
        >
          <span className="room-name">{room.name}</span>
          <span className="room-meta">
            {rectWidth(room.rect)}×{rectHeight(room.rect)}
            {room.stairs.length > 0 ? (
              <span className="room-stairs" title={`${room.stairs.length} stairs`}>
                <Icon id="stairs" size={12} />
              </span>
            ) : null}
          </span>
        </button>
      )}
      <span className="avatar-row">
        {occupants.map((person) => (
          <Avatar key={person.id} player={person} size={18} />
        ))}
      </span>
      {dm ? (
        <div className="room-tools">
          <div className="stepper is-small" role="group" aria-label={`${room.name} elevation`}>
            <button type="button" aria-label={`Lower ${room.name}`} title="Lower" onClick={(event) => nudge(-1, event)}>
              <Icon id="minus" size={13} />
            </button>
            <span className={elevation !== 0 ? 'is-raised' : ''} title="Elevation">
              {elevation}
            </span>
            <button type="button" aria-label={`Raise ${room.name}`} title="Raise" onClick={(event) => nudge(1, event)}>
              <Icon id="plus" size={13} />
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={room.visible}
            aria-label={room.visible ? `Hide ${room.name}` : `Reveal ${room.name}`}
            title={room.visible ? 'Visible to players' : 'Hidden from players'}
            onClick={(event) => {
              event.stopPropagation()
              useDungeonStore.getState().setRoomVisible(floor.id, room.id, !room.visible)
            }}
          >
            <Icon id={room.visible ? 'eye' : 'eyeOff'} />
          </button>
          <button
            type="button"
            className="icon-btn is-danger"
            aria-label={`Delete ${room.name}`}
            title="Delete room"
            onClick={removeRoom}
          >
            <Icon id="trash" />
          </button>
        </div>
      ) : null}
    </li>
  )
}
