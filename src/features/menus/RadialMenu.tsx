import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { resolveFloor } from '../../model/floors.ts'
import { connectedOpenings } from '../../model/openings.ts'
import {
  MAX_TOKEN_HOVER,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_HOVER,
  MIN_TOKEN_SIZE,
  playerHover,
  playerSize,
  playerStatuses,
} from '../../model/players.ts'
import { FEET_PER_TILE } from '../../model/scale.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { StatusId } from '../../model/status.ts'
import { openingAt, openingIsOpen } from '../../model/tiles.ts'
import type { Player, Room } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import type { OpeningMenu, PlayerMenu, RoomMenu } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Ring, RingButton, RingCore, RingStepper } from './Ring.tsx'
import { RING_SIZE, RING_SPOTS, RING_SPOTS_SIX, ringSeats } from './ringLayout.ts'

/** Right-click menus for tokens, rooms and doors, laid out as a ring around the click. */
export function RadialMenu() {
  const menu = useEditorStore((state) => state.menu)
  const activeFloorId = useEditorStore((state) => state.activeFloorId)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const players = useDungeonStore((state) => state.dungeon.players ?? [])
  const floor = resolveFloor(floors, activeFloorId)

  if (!menu) return null
  if (menu.kind === 'player') {
    const player = players.find((item) => item.id === menu.playerId)
    if (!player) return null
    return <TokenRing menu={menu} player={player} />
  }
  const room = floor.rooms.find((item) => item.id === menu.roomId)
  if (!room) return null
  if (menu.kind === 'opening') {
    return <OpeningRing menu={menu} floorId={floor.id} room={room} rooms={floor.rooms} />
  }
  return <RoomRing menu={menu} floorId={floor.id} room={room} />
}

function RingFrame({
  menu,
  className,
  children,
}: {
  menu: { x: number; y: number }
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`radial${className ? ` ${className}` : ''}`}
      style={{ left: menu.x, top: menu.y, width: RING_SIZE, height: RING_SIZE }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  )
}

function RoomRing({ menu, floorId, room }: { menu: RoomMenu; floorId: string; room: Room }) {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(room.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const elevation = room.elevation ?? 0

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  function nudge(delta: number): void {
    useDungeonStore.getState().nudgeRoomElevation(floorId, room.id, delta)
  }

  function remove(): void {
    const orphans = useDungeonStore.getState().deleteRoom(floorId, room.id)
    useEditorStore.getState().selectRoom(null)
    if (orphans.length > 0) useEditorStore.getState().promptStairLandings(orphans)
    closeMenu()
  }

  function resize(): void {
    const editor = useEditorStore.getState()
    editor.setTool('rooms')
    editor.beginResize(room.id)
  }

  function lookHere(): void {
    useDungeonStore.getState().setRoomVisible(floorId, room.id, true)
    useEditorStore.getState().focusRoom(floorId, room.id, FOCUS_INSET)
    useSessionStore.getState().reportFocus(floorId, room.id)
    closeMenu()
  }

  function commitRename(): void {
    useDungeonStore.getState().renameRoom(floorId, room.id, draftName)
    setRenaming(false)
    closeMenu()
  }

  if (renaming) {
    return (
      <RingFrame menu={menu}>
        <RingCore className="is-editing">
          <input
            ref={inputRef}
            className="ring-input"
            value={draftName}
            aria-label="Room name"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') closeMenu()
            }}
            onBlur={commitRename}
          />
        </RingCore>
      </RingFrame>
    )
  }

  return (
    <RingFrame menu={menu}>
      <Ring>
        <RingButton
          spot={RING_SPOTS_SIX.top}
          icon="look"
          label="Look here"
          title={`Pull player vision to ${room.name}`}
          onClick={lookHere}
        />
        <RingButton
          spot={RING_SPOTS_SIX.upperRight}
          icon="pencil"
          label="Rename"
          onClick={() => {
            setDraftName(room.name)
            setRenaming(true)
          }}
        />
        <RingStepper
          spot={RING_SPOTS_SIX.lowerRight}
          label="Room elevation"
          value={`${elevation}`}
          caption="ELEV"
          incLabel="Raise room"
          decLabel="Lower room"
          onInc={() => nudge(1)}
          onDec={() => nudge(-1)}
        />
        <RingButton spot={RING_SPOTS_SIX.bottom} icon="trash" label="Delete" danger onClick={remove} />
        <RingButton spot={RING_SPOTS_SIX.lowerLeft} icon="resize" label="Resize" onClick={resize} />
        <RingButton
          spot={RING_SPOTS_SIX.upperLeft}
          icon={room.visible ? 'eyeOff' : 'eye'}
          label={room.visible ? 'Hide' : 'Reveal'}
          title={room.visible ? 'Hide from players' : 'Reveal to players'}
          onClick={() => useDungeonStore.getState().setRoomVisible(floorId, room.id, !room.visible)}
        />
      </Ring>
    </RingFrame>
  )
}

function TokenRing({ menu, player }: { menu: PlayerMenu; player: Player }) {
  const [pickingStatus, setPickingStatus] = useState(false)
  const viewMode = useEditorStore((state) => state.viewMode)
  const size = playerSize(player)
  const hover = playerHover(player)
  const statuses = playerStatuses(player)
  const visible = player.visible !== false
  const store = useDungeonStore.getState()
  // Players never open a foe's stat block.
  const canOpenSheet = player.kind !== 'monster' || viewMode !== 'player'
  // Visibility is the DM's call; a player at the table cannot hide their own token.
  const canHide = useSessionStore((state) => state.role !== 'guest')

  if (pickingStatus) {
    return (
      <RingFrame menu={menu} className="is-status">
        <div className="radial-status">
          <div className="radial-status-head">
            <button type="button" className="radial-status-back" onClick={() => setPickingStatus(false)}>
              Back
            </button>
            <span>Status</span>
          </div>
          <div className="radial-status-list">
            {STATUS_EFFECTS.map((effect) => {
              const on = statuses.includes(effect.id)
              return (
                <button
                  key={effect.id}
                  type="button"
                  className={`radial-status-item${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  style={{ '--status': effect.color } as CSSProperties}
                  onClick={() => store.togglePlayerStatus(player.id, effect.id as StatusId)}
                >
                  <span className="radial-status-swatch" />
                  {effect.label}
                </button>
              )
            })}
          </div>
        </div>
      </RingFrame>
    )
  }

  // Clockwise from twelve o'clock; each control takes the next evenly spaced seat.
  type Seat = { x: number; y: number }
  const controls: Array<(spot: Seat) => ReactNode> = []
  if (canOpenSheet) {
    controls.push((spot) => (
      <RingButton
        key="sheet"
        spot={spot}
        icon="person"
        label="Sheet"
        title={player.kind === 'monster' ? 'Open stat block' : 'Open character sheet'}
        onClick={() => {
          const editor = useEditorStore.getState()
          editor.openSheet(player.id)
          editor.closeMenu()
        }}
      />
    ))
  }
  controls.push((spot) => (
    <RingButton
      key="status"
      spot={spot}
      icon="heart"
      label="Status"
      active={statuses.length > 0}
      title={statuses.length > 0 ? `${statuses.length} active` : 'Set conditions'}
      onClick={() => setPickingStatus(true)}
    />
  ))
  controls.push((spot) => (
    <RingStepper
      key="height"
      spot={spot}
      label="Height above floor"
      value={`${hover * FEET_PER_TILE} ft`}
      caption="HEIGHT"
      incLabel={`Raise ${FEET_PER_TILE} ft`}
      decLabel={`Lower ${FEET_PER_TILE} ft`}
      onInc={() => store.nudgePlayerHover(player.id, 1)}
      onDec={() => store.nudgePlayerHover(player.id, -1)}
      incDisabled={hover >= MAX_TOKEN_HOVER}
      decDisabled={hover <= MIN_TOKEN_HOVER}
    />
  ))
  controls.push((spot) => (
    <RingStepper
      key="size"
      spot={spot}
      label="Token size"
      value={`${size * FEET_PER_TILE} ft`}
      caption="SIZE"
      incLabel={`Larger (+${FEET_PER_TILE} ft)`}
      decLabel={`Smaller (−${FEET_PER_TILE} ft)`}
      onInc={() => store.nudgePlayerSize(player.id, 1)}
      onDec={() => store.nudgePlayerSize(player.id, -1)}
      incDisabled={size >= MAX_TOKEN_SIZE}
      decDisabled={size <= MIN_TOKEN_SIZE}
    />
  ))
  if (canHide) {
    controls.push((spot) => (
      <RingButton
        key="visible"
        spot={spot}
        icon={visible ? 'eyeOff' : 'eye'}
        label={visible ? 'Hide' : 'Reveal'}
        title={visible ? 'Hide from players' : 'Reveal to players'}
        onClick={() => store.setPlayerVisible(player.id, !visible)}
      />
    ))
  }
  const seats = ringSeats(controls.length)

  return (
    <RingFrame menu={menu}>
      <Ring>{controls.map((render, index) => render(seats[index]))}</Ring>
    </RingFrame>
  )
}

function OpeningRing({
  menu,
  floorId,
  room,
  rooms,
}: {
  menu: OpeningMenu
  floorId: string
  room: Room
  rooms: readonly Room[]
}) {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const kind = openingAt(room, menu.cellX, menu.cellY)
  const open = openingIsOpen(room, menu.cellX, menu.cellY)
  const label = kind === 'window' ? 'Window' : 'Door'

  function choose(next: boolean): void {
    const spots = connectedOpenings(rooms, room.id, menu.cellX, menu.cellY)
    useDungeonStore.getState().setOpeningOpen(floorId, spots, next)
    closeMenu()
  }

  return (
    <RingFrame menu={menu}>
      <Ring>
        <RingButton spot={RING_SPOTS.upperLeft} icon="doorOpen" label="Open" active={open} onClick={() => choose(true)} />
        <RingButton spot={RING_SPOTS.upperRight} icon="doors" label="Close" active={!open} onClick={() => choose(false)} />
        <RingCore className="is-label">
          <span>{label}</span>
          <small>{open ? 'Open' : 'Closed'}</small>
        </RingCore>
      </Ring>
    </RingFrame>
  )
}
