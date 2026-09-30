import { useEffect } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { canPlacePlayer, findStandable, occupiedCells, playerSize } from '../../model/players.ts'
import type { StairExit } from '../../model/stairs.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'

export function StairUsePrompt() {
  const prompt = useEditorStore((state) => state.stairUse)
  const close = useEditorStore((state) => state.closeStairUse)

  useEffect(() => {
    if (!prompt) return
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, close])

  if (!prompt) return null
  const ask = prompt

  const up = ask.exits.find((exit) => exit.dir === 'up')
  const down = ask.exits.find((exit) => exit.dir === 'down')

  function take(exit: StairExit): void {
    const dungeon = useDungeonStore.getState()
    const player = (dungeon.dungeon.players ?? []).find((item) => item.id === ask.playerId)
    const floor = dungeon.dungeon.floors.find((item) => item.id === exit.floorId)
    if (!player || !floor) {
      close()
      return
    }
    const size = playerSize(player)
    const ramps = floor.ramps ?? []
    const players = dungeon.dungeon.players ?? []
    const dest =
      canPlacePlayer(floor.rooms, players, floor.id, ask.x, ask.y, size, ramps, player.id)
        ? { x: ask.x, y: ask.y }
        : findStandable(floor.rooms, occupiedCells(players, floor.id, player.id), ramps)
    if (!dest) {
      close()
      return
    }
    dungeon.setRoomVisible(floor.id, exit.roomId, true)
    dungeon.movePlayer(player.id, floor.id, dest.x, dest.y)
    useSessionStore.getState().reportMove(player.id, floor.id, dest.x, dest.y)
    useEditorStore.getState().focusPlayer(player.id, FOCUS_INSET)
    close()
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close} role="presentation">
      <div
        className="dialog"
        role="alertdialog"
        aria-labelledby="stair-use-title"
        aria-describedby="stair-use-body"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="stair-use-title">Use the stairs?</h2>
        <p id="stair-use-body">{copy(up, down)}</p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={close}>
            Stay
          </button>
          {down ? (
            <button type="button" className="dialog-button" onClick={() => take(down)}>
              {up ? `Down · ${down.floorName}` : `Go down · ${down.floorName}`}
            </button>
          ) : null}
          {up ? (
            <button type="button" className="dialog-button" onClick={() => take(up)}>
              {down ? `Up · ${up.floorName}` : `Go up · ${up.floorName}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function copy(up: StairExit | undefined, down: StairExit | undefined): string {
  if (up && down) {
    return `These stairs go up to ${up.floorName} and down to ${down.floorName}. Which way?`
  }
  if (up) return `These stairs lead up to ${up.floorName}. Move through them?`
  if (down) return `These stairs lead down to ${down.floorName}. Move through them?`
  return 'These stairs do not connect to another floor.'
}
