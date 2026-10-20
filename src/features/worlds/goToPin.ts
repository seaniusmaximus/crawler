import type { World, WorldPin } from '../../model/worlds.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useWorldStore } from '../../state/worldStore.ts'

/** Whether going to this pin's battle map is something this seat can do right now. */
function canGoToPin(pin: WorldPin, host: boolean): boolean {
  if (!pin.mapId) return false
  // A player can only go back down to where the party already is; moving them is the DM's call.
  return host || pin.mapId === useNotesStore.getState().mapId
}

/**
 * Down from the world map to the battle map a pin leads to. Where the party already
 * is, that's just closing the world map; anywhere else the DM moves the party, after
 * asking (see TravelConfirm) when players' screens would switch. `confirmed` is that answer.
 */
export function goToPin(world: World, pin: WorldPin, confirmed = false): void {
  const session = useSessionStore.getState()
  const store = useWorldStore.getState()
  const host = session.role === 'host'
  if (!pin.mapId || !canGoToPin(pin, host)) return
  const here = pin.mapId === useNotesStore.getState().mapId
  if (!here) {
    if (session.mapBusy) return
    if (session.peers.length > 0 && !confirmed) {
      store.askTravel({ pinId: pin.id, mapId: pin.mapId })
      return
    }
    session.switchMap(pin.mapId)
  }
  // Everyone goes down to the battle map together.
  if (host && store.shownId === world.id) store.show(null)
  store.view(null)
}
