import { useEffect, useState } from 'react'
import * as api from '../../net/api.ts'
import { pinName, type World, type WorldPin } from '../../model/worlds.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useWorldStore } from '../../state/worldStore.ts'
import { goToPin } from './goToPin.ts'

function stay(): void {
  useWorldStore.getState().askTravel(null)
}

function move(world: World, pin: WorldPin): void {
  useWorldStore.getState().askTravel(null)
  goToPin(world, pin, true)
}

/** "Move the party?" when going down a pin would switch players' screens; Enter moves them, Escape stays. */
export function TravelConfirm({ world }: { world: World }) {
  const ask = useWorldStore((state) => state.travelAsk)
  const roomId = useSessionStore((state) => state.roomId)
  const players = useSessionStore((state) => state.peers.length)
  // The battle map's name, kept with its id so an earlier question's name never shows on this one.
  const [found, setFound] = useState<{ id: string; name: string } | null>(null)
  const pin = ask ? world.pins.find((item) => item.id === ask.pinId && item.mapId === ask.mapId) : undefined
  const mapId = pin?.mapId ?? null

  useEffect(() => {
    if (!roomId || !mapId) return
    let live = true
    api.listMaps(roomId).then(
      (maps) => {
        const map = maps.find((item) => item.id === mapId)
        if (live && map) setFound({ id: map.id, name: map.name })
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [roomId, mapId])

  useEffect(() => {
    if (!pin) return
    const target = pin
    function onKey(event: KeyboardEvent): void {
      if (event.code !== 'Escape' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return
      // Ahead of the world map's own keys, so Escape only closes this.
      event.stopPropagation()
      event.preventDefault()
      if (event.code === 'Escape') stay()
      else move(world, target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pin, world])

  if (!pin) return null

  // The pin's name stands in until the battle map's comes.
  const place = found && found.id === pin.mapId ? found.name : pinName(pin)
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={stay}>
      <div
        className="dialog world-travel-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="world-travel-title"
        aria-describedby="world-travel-body"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="world-travel-title">Move the party?</h2>
        <p id="world-travel-body">
          The party travels to <strong>{place}</strong>.{' '}
          {players === 1 ? "A player's screen" : `${players} players' screens`} will switch to it.
        </p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={stay}>
            Stay here
          </button>
          <button type="button" className="dialog-button is-primary" autoFocus onClick={() => move(world, pin)}>
            Move the party
          </button>
        </div>
      </div>
    </div>
  )
}
