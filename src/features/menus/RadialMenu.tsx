import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { resolveFloor } from '../../model/floors.ts'
import { connectedOpenings } from '../../model/openings.ts'
import {
  characterNameOf,
  isMonster,
  MAX_TOKEN_HOVER,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_HOVER,
  MIN_TOKEN_SIZE,
  occupantRoom,
  playerHover,
  playerSize,
  playerStatuses,
} from '../../model/players.ts'
import { FEET_PER_TILE } from '../../model/scale.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { StatusId } from '../../model/status.ts'
import { openingIsLocked, openingIsOpen } from '../../model/tiles.ts'
import type { Player, Room, RoomObject } from '../../model/types.ts'
import { objectHover, objectScale, rehoveredObject, rescaledObject } from '../../model/objects.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import type { ObjectMenu, OpeningMenu, PlayerMenu, RoomMenu } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { placeLabel, revealTitle, tokenShown } from '../party/tokenInfo.ts'
import { TILESETS, tilesetById } from '../../tiles/sets/index.ts'
import { Ring, RingButton, RingCore, RingStepper } from './Ring.tsx'
import { CARD_FRAME, ringLayout, type RingLayout } from './ringLayout.ts'

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
  if (menu.kind === 'object') {
    const object = room.objects?.find((item) => item.id === menu.objectId)
    if (!object) return null
    return <ObjectRing menu={menu} floorId={floor.id} room={room} rooms={floor.rooms} object={object} />
  }
  return <RoomRing menu={menu} floorId={floor.id} room={room} />
}

/** The menu's box, centred on the click: as big as its ring needs, or a card's frame. */
function RingFrame({
  menu,
  ring,
  className,
  children,
}: {
  menu: { x: number; y: number }
  ring?: RingLayout
  className?: string
  children: ReactNode
}) {
  const size = ring?.size ?? CARD_FRAME
  return (
    <div
      className={`radial${className ? ` ${className}` : ''}`}
      style={{ left: menu.x, top: menu.y, width: size, height: size }}
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
  const [pulling, setPulling] = useState(false)
  const [pickingTileset, setPickingTileset] = useState(false)
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

  function split(): void {
    useDungeonStore.getState().splitRoom(floorId, room.id)
    closeMenu()
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

  if (pulling) {
    return <PullPicker menu={menu} floorId={floorId} room={room} onBack={() => setPulling(false)} />
  }

  if (pickingTileset) {
    return <TilesetPicker menu={menu} floorId={floorId} room={room} onBack={() => setPickingTileset(false)} />
  }

  // Eight seats, clockwise from twelve o'clock.
  const ring = ringLayout(8)
  const seat = ring.seats
  return (
    <RingFrame menu={menu} ring={ring}>
      <Ring radius={ring.radius}>
        <RingButton
          spot={seat[0]}
          icon="look"
          label="Look here"
          title={`Pull player vision to ${room.name}`}
          onClick={lookHere}
        />
        <RingButton
          spot={seat[1]}
          icon="pull"
          label="Pull token"
          title={`Bring a token into ${room.name}`}
          onClick={() => setPulling(true)}
        />
        <RingButton
          spot={seat[2]}
          icon="pencil"
          label="Rename"
          onClick={() => {
            setDraftName(room.name)
            setRenaming(true)
          }}
        />
        <RingStepper
          spot={seat[3]}
          label="Room elevation"
          value={`${elevation}`}
          caption="ELEV"
          incLabel="Raise room"
          decLabel="Lower room"
          onInc={() => nudge(1)}
          onDec={() => nudge(-1)}
        />
        <RingButton spot={seat[4]} icon="trash" label="Delete" danger onClick={remove} />
        {room.parts ? (
          <RingButton
            spot={seat[5]}
            icon="split"
            label="Split"
            title={`Split ${room.name} back into the rooms it was merged from`}
            onClick={split}
          />
        ) : (
          <RingButton spot={seat[5]} icon="resize" label="Resize" onClick={resize} />
        )}
        <RingButton
          spot={seat[6]}
          icon={room.visible ? 'eyeOff' : 'eye'}
          label={room.visible ? 'Hide' : 'Reveal'}
          title={room.visible ? 'Hide from players until they see into it again' : 'Mark explored: players see it on their map'}
          onClick={() => useDungeonStore.getState().setRoomVisible(floorId, room.id, !room.visible)}
        />
        <RingButton
          spot={seat[7]}
          icon="tileset"
          label="Tileset"
          active={Boolean(room.tileset)}
          title={`Change the tileset of ${room.name} alone`}
          onClick={() => setPickingTileset(true)}
        />
      </Ring>
    </RingFrame>
  )
}

/**
 * Every token on this map, party first, to bring into the room: it lands on the
 * free spot nearest where the room was right-clicked, from any floor.
 */
function PullPicker({
  menu,
  floorId,
  room,
  onBack,
}: {
  menu: RoomMenu
  floorId: string
  room: Room
  onBack: () => void
}) {
  const players = useDungeonStore((state) => state.dungeon.players ?? [])
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const [full, setFull] = useState<string | null>(null)
  const byName = (a: Player, b: Player) => characterNameOf(a).localeCompare(characterNameOf(b))
  const listed = [
    ...players.filter((player) => !isMonster(player)).sort(byName),
    ...players.filter(isMonster).sort(byName),
  ]
  const here = (player: Player) => {
    if (player.floorId !== floorId) return false
    const floor = floors.find((item) => item.id === floorId)
    return occupantRoom(floor?.rooms ?? [], player.x, player.y)?.id === room.id
  }

  function pull(player: Player): void {
    const pulled = useDungeonStore.getState().pullPlayer(player.id, floorId, room.id, { x: menu.cellX, y: menu.cellY })
    if (!pulled) {
      setFull(characterNameOf(player))
      return
    }
    useEditorStore.getState().closeMenu()
  }

  return (
    <RingFrame menu={menu} className="is-status">
      <div className="radial-status radial-pull">
        <div className="radial-status-head">
          <button type="button" className="radial-status-back" onClick={onBack}>
            Back
          </button>
          <span>Pull to {room.name}</span>
        </div>
        {listed.length === 0 ? (
          <p className="radial-pull-note">No tokens on this map yet.</p>
        ) : (
          <div className="radial-pull-list">
            {listed.map((player) => {
              const inRoom = here(player)
              return (
                <button
                  key={player.id}
                  type="button"
                  className="radial-pull-item"
                  disabled={inRoom}
                  title={inRoom ? 'Already in this room' : `Move to ${room.name}`}
                  onClick={() => pull(player)}
                >
                  <Avatar player={player} size={22} dim={!tokenShown(player, floors, players, 'player')} />
                  <span className="radial-pull-name">{characterNameOf(player)}</span>
                  <span className="radial-pull-place">{inRoom ? 'Here' : placeLabel(player, floors)}</span>
                </button>
              )
            })}
          </div>
        )}
        {full ? <p className="radial-pull-note is-warn">No free space in {room.name} for {full}.</p> : null}
      </div>
    </RingFrame>
  )
}

/**
 * The tilesets one room can be drawn in. "Map" makes it follow the map's tileset
 * again; picking the map's own tileset does the same.
 */
function TilesetPicker({
  menu,
  floorId,
  room,
  onBack,
}: {
  menu: RoomMenu
  floorId: string
  room: Room
  onBack: () => void
}) {
  const mapTileset = useDungeonStore((state) => tilesetById(state.dungeon.tileset))
  const current = room.tileset ? tilesetById(room.tileset) : null

  function choose(id: string | null): void {
    useDungeonStore.getState().setRoomTileset(floorId, room.id, id)
    useEditorStore.getState().closeMenu()
  }

  return (
    <RingFrame menu={menu} className="is-status">
      <div className="radial-status radial-pull">
        <div className="radial-status-head">
          <button type="button" className="radial-status-back" onClick={onBack}>
            Back
          </button>
          <span>Tileset · {room.name}</span>
        </div>
        <div className="radial-pull-list radial-tilesets">
          <button
            type="button"
            className={`radial-pull-item${current ? '' : ' is-on'}`}
            aria-pressed={!current}
            title={`Draw ${room.name} in the map's tileset`}
            onClick={() => choose(null)}
          >
            <span className="radial-pull-name">Same as map</span>
            <span className="radial-pull-place">{mapTileset.name}</span>
          </button>
          {TILESETS.map((set) => {
            const on = current?.id === set.id
            return (
              <button
                key={set.id}
                type="button"
                className={`radial-pull-item${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => choose(set.id)}
              >
                <span className="radial-pull-name">{set.name}</span>
                <span className="radial-pull-place">{on ? 'This room' : set.id === mapTileset.id ? 'Map' : ''}</span>
              </button>
            )
          })}
        </div>
      </div>
    </RingFrame>
  )
}

/** Turn an object either way, size it, raise it off the floor, or take it away. */
function ObjectRing({
  menu,
  floorId,
  room,
  rooms,
  object,
}: {
  menu: ObjectMenu
  floorId: string
  room: Room
  rooms: readonly Room[]
  object: RoomObject
}) {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const store = useDungeonStore.getState()
  const scale = objectScale(object)
  const hover = objectHover(object)

  function turn(steps: number): void {
    useDungeonStore.getState().turnObject(floorId, room.id, object.id, steps)
  }

  function remove(): void {
    useDungeonStore.getState().removeObject(floorId, room.id, object.id)
    useEditorStore.getState().selectObject(null)
    closeMenu()
  }

  // A step that wouldn't fit (into a wall, or onto something at that height) is greyed out.
  const ring = ringLayout(5)
  return (
    <RingFrame menu={menu} ring={ring}>
      <Ring radius={ring.radius}>
        <RingButton spot={ring.seats[0]} icon="rotateRight" label="Turn right" onClick={() => turn(1)} />
        <RingStepper
          spot={ring.seats[1]}
          label="Object size"
          value={`${scale}×`}
          caption="SIZE"
          incLabel="Larger"
          decLabel="Smaller"
          onInc={() => store.nudgeObjectScale(floorId, room.id, object.id, 1)}
          onDec={() => store.nudgeObjectScale(floorId, room.id, object.id, -1)}
          incDisabled={!rescaledObject(rooms, room, object, 1)}
          decDisabled={!rescaledObject(rooms, room, object, -1)}
        />
        <RingStepper
          spot={ring.seats[2]}
          label="Height above floor"
          value={`${hover * FEET_PER_TILE} ft`}
          caption="HEIGHT"
          incLabel={`Raise ${FEET_PER_TILE} ft`}
          decLabel={`Lower ${FEET_PER_TILE} ft`}
          onInc={() => store.nudgeObjectHover(floorId, room.id, object.id, 1)}
          onDec={() => store.nudgeObjectHover(floorId, room.id, object.id, -1)}
          incDisabled={!rehoveredObject(rooms, room, object, 1)}
          decDisabled={!rehoveredObject(rooms, room, object, -1)}
        />
        <RingButton spot={ring.seats[3]} icon="trash" label="Remove" danger onClick={remove} />
        <RingButton spot={ring.seats[4]} icon="rotateLeft" label="Turn left" onClick={() => turn(-1)} />
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
  const monster = isMonster(player)
  // A monster's switch reveals it out of sight; it shows on its own once its room is in sight.
  const visible = monster ? player.visible === true : player.visible !== false
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
        label={visible ? (monster ? 'Unreveal' : 'Hide') : 'Reveal'}
        title={
          monster
            ? revealTitle(characterNameOf(player), visible)
            : visible
              ? 'Hide from players'
              : 'Reveal to players'
        }
        onClick={() => store.setPlayerVisible(player.id, !visible)}
      />
    ))
  }
  const ring = ringLayout(controls.length)

  return (
    <RingFrame menu={menu} ring={ring}>
      <Ring radius={ring.radius}>{controls.map((render, index) => render(ring.seats[index]))}</Ring>
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
  const open = openingIsOpen(room, menu.cellX, menu.cellY)
  const locked = openingIsLocked(room, menu.cellX, menu.cellY)

  function choose(next: boolean): void {
    const spots = connectedOpenings(rooms, room.id, menu.cellX, menu.cellY)
    useDungeonStore.getState().setOpeningOpen(floorId, spots, next)
    closeMenu()
  }

  function lock(next: boolean): void {
    const spots = connectedOpenings(rooms, room.id, menu.cellX, menu.cellY)
    useDungeonStore.getState().setOpeningLocked(floorId, spots, next)
    closeMenu()
  }

  // Open upper left, Close upper right, Lock below.
  const ring = ringLayout(3, { start: 300 })
  return (
    <RingFrame menu={menu} ring={ring}>
      <Ring radius={ring.radius}>
        <RingButton spot={ring.seats[0]} icon="doorOpen" label="Open" active={open} onClick={() => choose(true)} />
        <RingButton spot={ring.seats[1]} icon="doors" label="Close" active={!open} onClick={() => choose(false)} />
        <RingButton
          spot={ring.seats[2]}
          icon={locked ? 'unlock' : 'lock'}
          label={locked ? 'Unlock' : 'Lock'}
          title={locked ? 'Let players open and close it' : 'Stop players opening or closing it'}
          active={locked}
          onClick={() => lock(!locked)}
        />
      </Ring>
    </RingFrame>
  )
}
