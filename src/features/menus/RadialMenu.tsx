import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { resolveFloor } from '../../model/floors.ts'
import { connectedOpenings } from '../../model/openings.ts'
import { characterNameOf, playerHover, playerSize, playerStatuses } from '../../model/players.ts'
import { FEET_PER_TILE } from '../../model/scale.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { StatusId } from '../../model/status.ts'
import { openingAt, openingIsOpen } from '../../model/tiles.ts'
import type { Player, Room } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import type { OpeningMenu, PlayerMenu, RoomMenu } from '../../state/editorStore.ts'
import {
  RadialWheel,
  WHEEL_INNER,
  WHEEL_MID,
  WHEEL_OUTER,
  WHEEL_SIZE,
  type WheelSlice,
} from './RadialWheel.tsx'

type ItemId = 'raise' | 'lower' | 'rename' | 'resize' | 'delete' | 'visible'
type TokenItemId = 'raise' | 'lower' | 'grow' | 'shrink' | 'visible' | 'status'

/** Right-click menu for whole-room actions; tiles are edited with the tools. */
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
    return <TokenRadial menu={menu} player={player} />
  }
  const room = floor.rooms.find((item) => item.id === menu.roomId)
  if (!room) return null
  if (menu.kind === 'opening') {
    return <OpeningRadial menu={menu} floorId={floor.id} room={room} rooms={floor.rooms} />
  }
  return <RoomRadial menu={menu} floorId={floor.id} room={room} />
}

function RoomRadial({
  menu,
  floorId,
  room,
}: {
  menu: RoomMenu
  floorId: string
  room: Room
}) {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(room.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const slices: WheelSlice[] = [
    { id: 'lower', label: 'Lower', start: -45, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_MID },
    { id: 'raise', label: 'Raise', start: -45, sweep: 90, r0: WHEEL_MID, r1: WHEEL_OUTER },
    { id: 'rename', label: 'Rename', start: 45, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_OUTER },
    { id: 'resize', label: 'Resize', start: 135, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_MID },
    { id: 'delete', label: 'Delete', start: 135, sweep: 90, r0: WHEEL_MID, r1: WHEEL_OUTER, danger: true },
    {
      id: 'visible',
      icon: room.visible ? 'hide' : 'reveal',
      label: room.visible ? 'Hide' : 'Reveal',
      start: 225,
      sweep: 90,
      r0: WHEEL_INNER,
      r1: WHEEL_OUTER,
    },
  ]

  function choose(id: ItemId): void {
    if (id === 'raise' || id === 'lower') {
      useDungeonStore.getState().nudgeRoomElevation(floorId, room.id, id === 'raise' ? 1 : -1)
      return
    }
    if (id === 'delete') {
      const orphans = useDungeonStore.getState().deleteRoom(floorId, room.id)
      useEditorStore.getState().selectRoom(null)
      if (orphans.length > 0) useEditorStore.getState().promptStairLandings(orphans)
      closeMenu()
      return
    }
    if (id === 'visible') {
      useDungeonStore.getState().setRoomVisible(floorId, room.id, !room.visible)
      return
    }
    if (id === 'resize') {
      const editor = useEditorStore.getState()
      editor.setTool('rooms')
      editor.beginResize(room.id)
      return
    }
    setDraftName(room.name)
    setRenaming(true)
  }

  function commitRename(): void {
    useDungeonStore.getState().renameRoom(floorId, room.id, draftName)
    setRenaming(false)
    closeMenu()
  }

  return (
    <div
      className={`radial${renaming ? ' is-editing' : ''}`}
      style={{ left: menu.x, top: menu.y, width: WHEEL_SIZE, height: WHEEL_SIZE }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renaming ? null : <RadialWheel slices={slices} onChoose={(id) => choose(id as ItemId)} />}
      <div className={`radial-core${renaming ? ' is-editing' : ''}`} title={room.name}>
        {renaming ? (
          <input
            ref={inputRef}
            className="radial-input"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') closeMenu()
            }}
            onBlur={commitRename}
          />
        ) : (
          <span>{room.name}</span>
        )}
      </div>
    </div>
  )
}

function TokenRadial({ menu, player }: { menu: PlayerMenu; player: Player }) {
  const [pickingStatus, setPickingStatus] = useState(false)
  const size = playerSize(player)
  const hover = playerHover(player)
  const statuses = playerStatuses(player)
  const visible = player.visible !== false
  const character = characterNameOf(player)

  const slices: WheelSlice[] = [
    { id: 'lower', label: 'Lower', start: -45, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_MID },
    { id: 'raise', label: 'Raise', start: -45, sweep: 90, r0: WHEEL_MID, r1: WHEEL_OUTER },
    { id: 'status', label: 'Status', start: 45, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_OUTER },
    { id: 'shrink', label: '−5 ft', start: 135, sweep: 90, r0: WHEEL_INNER, r1: WHEEL_MID },
    { id: 'grow', label: '+5 ft', start: 135, sweep: 90, r0: WHEEL_MID, r1: WHEEL_OUTER },
    {
      id: 'visible',
      icon: visible ? 'hide' : 'reveal',
      label: visible ? 'Hide' : 'Reveal',
      start: 225,
      sweep: 90,
      r0: WHEEL_INNER,
      r1: WHEEL_OUTER,
    },
  ]

  function choose(id: TokenItemId): void {
    if (id === 'raise') {
      useDungeonStore.getState().nudgePlayerHover(player.id, 1)
      return
    }
    if (id === 'lower') {
      useDungeonStore.getState().nudgePlayerHover(player.id, -1)
      return
    }
    if (id === 'grow') {
      useDungeonStore.getState().nudgePlayerSize(player.id, 1)
      return
    }
    if (id === 'shrink') {
      useDungeonStore.getState().nudgePlayerSize(player.id, -1)
      return
    }
    if (id === 'visible') {
      useDungeonStore.getState().setPlayerVisible(player.id, !visible)
      return
    }
    setPickingStatus(true)
  }

  function toggleStatus(id: StatusId): void {
    useDungeonStore.getState().togglePlayerStatus(player.id, id)
  }

  return (
    <div
      className={`radial${pickingStatus ? ' is-status' : ''}`}
      style={{ left: menu.x, top: menu.y, width: WHEEL_SIZE, height: WHEEL_SIZE }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {pickingStatus ? (
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
                  onClick={() => toggleStatus(effect.id)}
                >
                  <span className="radial-status-swatch" />
                  {effect.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <RadialWheel slices={slices} onChoose={(id) => choose(id as TokenItemId)} />
          <div className="radial-core" title={character}>
            <span>
              {character}
              <small>
                {size}×{size}
                {hover > 0 ? ` · ${hover * FEET_PER_TILE} ft` : ''}
              </small>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function OpeningRadial({
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

  const slices: WheelSlice[] = [
    { id: 'open', label: 'Open', start: -90, sweep: 180, r0: WHEEL_INNER, r1: WHEEL_OUTER, active: open },
    {
      id: 'close',
      label: 'Close',
      start: 90,
      sweep: 180,
      r0: WHEEL_INNER,
      r1: WHEEL_OUTER,
      active: !open,
    },
  ]

  function choose(id: 'open' | 'close'): void {
    const spots = connectedOpenings(rooms, room.id, menu.cellX, menu.cellY)
    useDungeonStore.getState().setOpeningOpen(floorId, spots, id === 'open')
    closeMenu()
  }

  return (
    <div
      className="radial"
      style={{ left: menu.x, top: menu.y, width: WHEEL_SIZE, height: WHEEL_SIZE }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <RadialWheel slices={slices} onChoose={(id) => choose(id as 'open' | 'close')} />
      <div className="radial-core" title={label}>
        <span>{label}</span>
      </div>
    </div>
  )
}
