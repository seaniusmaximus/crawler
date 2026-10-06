import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { floorAtOrder, floorTag, floorsTopDown, GROUND_ORDER } from '../../model/floors.ts'
import { playersInRoom } from '../../model/players.ts'
import { rectHeight, rectWidth } from '../../model/rect.ts'
import type { Floor, Player, Room } from '../../model/types.ts'
import { roomExplored, shownFloors, type ViewMode } from '../../model/visibility.ts'
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
  return mode === 'player' ? floor.rooms.filter(roomExplored) : floor.rooms
}

function occupantsOf(floor: Floor, room: Room, tokens: readonly Player[], mode: ViewMode): Player[] {
  return playersInRoom(tokens, floor, room.id).filter((token) =>
    tokenShown(token, [floor], tokens, mode),
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

/**
 * Publish the collapsed tower's height as --floor-tower-height on the bottom-centre
 * dock, so neighbours (the save bubble) can match it. It keeps the last value
 * while the drawer is open.
 */
function useShareTowerHeight() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    const dock = el?.closest<HTMLElement>('.hud-bottom-center')
    if (!el || !dock) return
    const observer = new ResizeObserver(() => {
      dock.style.setProperty('--floor-tower-height', `${el.offsetHeight}px`)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

/**
 * The collapsed list shows three floors and scrolls past that; keep the floor in
 * view scrolled into sight when it changes (from the map, the stack or stairs).
 */
function useKeepActiveInView(list: RefObject<HTMLDivElement | null>, activeId: string | null) {
  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('.floor-pick.is-active')
    if (!box || !row) return
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
    }
  }, [list, activeId])
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
  const tower = useShareTowerHeight()
  const list = useRef<HTMLDivElement>(null)
  useKeepActiveInView(list, activeId)
  const dm = viewMode !== 'player'
  const [renaming, setRenaming] = useState<string | null>(null)

  return (
    <section ref={tower} className="panel floor-tower scroll-h" aria-label="Floors">
      <FloorStack floors={floors} activeId={activeId} width={140} height={stackHeight(floors.length, 132)} />
      {floors.length === 0 ? (
        <p className="panel-empty">No revealed rooms</p>
      ) : (
        <div ref={list} className="floor-tower-list">
          {floors.map((floor) => {
            const active = floor.id === activeId
            const busy = shownRoomsOf(floor, viewMode)
              .map((room) => ({ room, people: occupantsOf(floor, room, tokens, viewMode) }))
              .filter((entry) => entry.people.length > 0)
            if (renaming === floor.id) {
              return (
                <div key={floor.id} className={`floor-pick is-renaming${active ? ' is-active' : ''}`}>
                  <span className="floor-tag">{floorTag(floor.order)}</span>
                  <FloorNameInput floor={floor} onDone={() => setRenaming(null)} />
                </div>
              )
            }
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
                <span
                  className="floor-pick-name"
                  title={dm ? 'Double-click to rename' : undefined}
                  onDoubleClick={dm ? () => setRenaming(floor.id) : undefined}
                >
                  {floor.name}
                </span>
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
        {dm ? <FloorEdit floors={floors} activeId={activeId} layout="column" /> : null}
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
  const dm = viewMode !== 'player'
  const [renaming, setRenaming] = useState<string | null>(null)

  return (
    <section className="panel floor-drawer scroll-v" aria-label="Floors and rooms">
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Floors</span>
        </h2>
        <span className="floor-drawer-tools">
          {dm ? <FloorEdit floors={floors} activeId={activeId} layout="row" /> : null}
          <button
            type="button"
            className="icon-btn is-boxed"
            onClick={onCollapse}
            aria-label="Collapse floors"
            title="Collapse"
          >
            <Icon id="chevronDown" />
          </button>
        </span>
      </header>

      <div className="floor-drawer-stack">
        <FloorStack floors={floors} activeId={activeId} width={100} height={stackHeight(floors.length, 136)} />
        <div className="floor-drawer-list">
          {floors.map((floor, index) => {
            const on = floor.id === activeId
            const count = shownRoomsOf(floor, viewMode).length
            const people = tokens.filter(
              (token) => token.floorId === floor.id && tokenShown(token, floors, tokens, viewMode),
            )
            return (
              <div key={floor.id} className="floor-drawer-item">
                {index > 0 ? <span className="floor-link" aria-hidden /> : null}
                {renaming === floor.id ? (
                  <div className={`floor-row is-renaming${on ? ' is-active' : ''}`}>
                    <span className="floor-tag">{floorTag(floor.order)}</span>
                    <FloorNameInput floor={floor} onDone={() => setRenaming(null)} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`floor-row${on ? ' is-active' : ''}`}
                    aria-pressed={on}
                    onClick={() => setActiveFloor(floor.id)}
                  >
                    <span className="floor-tag">{floorTag(floor.order)}</span>
                    <span className="floor-row-copy">
                      <span
                        title={dm ? 'Double-click to rename' : undefined}
                        onDoubleClick={dm ? () => setRenaming(floor.id) : undefined}
                      >
                        {floor.name}
                      </span>
                      <small>
                        {count} {count === 1 ? 'room' : 'rooms'}
                      </small>
                    </span>
                    <span className="avatar-row">
                      {people.map((person) => (
                        <Avatar key={person.id} player={person} size={18} dim={!tokenShown(person, floors, tokens, 'player')} />
                      ))}
                    </span>
                  </button>
                )}
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
                {active.rooms.length - hidden} explored · {hidden} unexplored
              </span>
            )}
          </div>
          <ul className="room-list">
            {rooms.length === 0 ? (
              <li className="panel-empty">
                {viewMode === 'player' ? 'Nothing explored on this floor' : 'Drag on the grid to paint a room'}
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
            aria-label={room.visible ? `Mark ${room.name} unexplored` : `Mark ${room.name} explored`}
            title={room.visible ? 'Explored: players see it, greyed out when they cannot see in' : 'Unexplored: hidden from players until they see into it'}
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

/** Where a new floor goes, with the tag it will get. */
function newFloorTags(floors: readonly Floor[]): { above: string; below: string } {
  const orders = floors.map((floor) => floor.order)
  return { above: floorTag(Math.max(...orders) + 1), below: floorTag(Math.min(...orders) - 1) }
}

/** What deleting a floor takes with it, in a line. */
function deleteSummary(floor: Floor, floors: readonly Floor[], tokens: readonly Player[]): string {
  const rooms = floor.rooms.length
  const here = tokens.filter((token) => token.floorId === floor.id)
  const monsters = here.filter((token) => token.kind === 'monster').length
  const party = here.length - monsters
  const parts: string[] = []
  if (rooms > 0) parts.push(`${rooms} ${rooms === 1 ? 'room' : 'rooms'}`)
  if (monsters > 0) parts.push(`${monsters} ${monsters === 1 ? 'monster' : 'monsters'}`)
  const refuge = floorAtOrder(floors, floor.order - 1) ?? floorAtOrder(floors, floor.order + 1)
  // "1 room goes", but "2 rooms go" and "1 room and 1 monster go".
  const plural = parts.length > 1 || rooms > 1 || (rooms === 0 && monsters > 1)
  const goes = parts.length > 0 ? `${parts.join(' and ')} ${plural ? 'go' : 'goes'} with it.` : "It's empty."
  const moves = party > 0 && refuge ? ` The party moves to ${floorTag(refuge.order)}.` : ''
  return `${goes}${moves}`
}

/**
 * Add a floor on top or a basement underneath, or delete the floor in view.
 * Each opens a small card beside the buttons; a click elsewhere closes it.
 */
function FloorEdit({
  floors,
  activeId,
  layout,
}: {
  floors: Floor[]
  activeId: string | null
  layout: 'column' | 'row'
}) {
  const [open, setOpen] = useState<'add' | 'delete' | null>(null)
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor)
  const box = useRef<HTMLDivElement>(null)
  const active = floors.find((floor) => floor.id === activeId)
  const tags = newFloorTags(floors)
  const lastFloor = floors.length <= 1

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function add(where: 'above' | 'below'): void {
    setActiveFloor(useDungeonStore.getState().addFloor(where))
    setOpen(null)
  }

  function remove(): void {
    if (!active) return
    const refuge = floorAtOrder(floors, active.order - 1) ?? floorAtOrder(floors, active.order + 1)
    useDungeonStore.getState().deleteFloor(active.id)
    if (refuge) setActiveFloor(refuge.id)
    setOpen(null)
  }

  return (
    <div ref={box} className={`floor-edit is-${layout}`}>
      <button
        type="button"
        className="icon-btn"
        aria-expanded={open === 'add'}
        aria-label="Add a floor"
        title="Add a floor"
        onClick={() => setOpen(open === 'add' ? null : 'add')}
      >
        <Icon id="plus" size={16} />
      </button>
      <button
        type="button"
        className="icon-btn is-danger"
        aria-expanded={open === 'delete'}
        aria-label={active ? `Delete ${floorTag(active.order)}, ${active.name}` : 'Delete floor'}
        title={lastFloor ? 'A map keeps at least one floor' : 'Delete this floor'}
        disabled={lastFloor || !active}
        onClick={() => setOpen(open === 'delete' ? null : 'delete')}
      >
        <Icon id="trash" size={16} />
      </button>
      {open === 'add' ? (
        <div className="floor-popover" role="dialog" aria-label="Add a floor">
          <button type="button" className="floor-popover-option" onClick={() => add('above')}>
            <span className="floor-tag">{tags.above}</span>
            <span>New floor on top</span>
          </button>
          <button type="button" className="floor-popover-option" onClick={() => add('below')}>
            <span className="floor-tag">{tags.below}</span>
            <span>New basement below</span>
          </button>
        </div>
      ) : null}
      {open === 'delete' && active ? (
        <div className="floor-popover" role="alertdialog" aria-label="Delete floor">
          <p className="floor-popover-copy">
            <strong>
              Delete {floorTag(active.order)} · {active.name}?
            </strong>
            <span>{deleteSummary(active, floors, tokens)}</span>
          </p>
          <div className="floor-popover-actions">
            <button type="button" className="text-btn" onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button type="button" className="outline-btn is-danger is-small" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** A floor's name, being retyped: Enter or leaving keeps it, Escape drops it. */
function FloorNameInput({ floor, onDone }: { floor: Floor; onDone: () => void }) {
  const [draft, setDraft] = useState(floor.name)
  // Escape closes the input, and the blur that follows must not save anyway.
  const settled = useRef(false)
  const finish = (save: boolean) => {
    if (settled.current) return
    settled.current = true
    if (save) useDungeonStore.getState().renameFloor(floor.id, draft)
    onDone()
  }
  return (
    <input
      className="name-input is-floor"
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      aria-label={`Name of ${floorTag(floor.order)}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
    />
  )
}
