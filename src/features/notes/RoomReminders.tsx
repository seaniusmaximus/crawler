import { useEffect, useState } from 'react'
import { mapReminders } from '../../model/noteMap.ts'
import { noteTitle } from '../../model/notes.ts'
import { isMonster, occupantRoom } from '../../model/players.ts'
import type { Dungeon } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { lookAtRoom } from './noteHooks.ts'

/** How long a reminder stays up. */
const SHOW_MS = 12_000
/** The same room doesn't remind again for this long, so a party milling about isn't nagged. */
const QUIET_MS = 90_000
const MAX_SHOWN = 3

interface RoomReminder {
  key: number
  floorId: string
  roomId: string
  roomName: string
  lines: string[]
}

let nextKey = 0

/** Which room each party token stands in. */
function partyRooms(dungeon: Dungeon): Map<string, string> {
  const rooms = new Map<string, string>()
  for (const player of dungeon.players ?? []) {
    if (isMonster(player)) continue
    const floor = dungeon.floors.find((item) => item.id === player.floorId)
    const room = floor ? occupantRoom(floor.rooms, player.x, player.y) : undefined
    if (room) rooms.set(player.id, `${floor?.id}\n${room.id}`)
  }
  return rooms
}

/**
 * The DM's nudge as the party walks into a room with something to remember: the
 * traps and hidden zones there, and the DM's notes pinned to it.
 */
export function RoomReminders() {
  const role = useSessionStore((state) => state.role)
  const [shown, setShown] = useState<RoomReminder[]>([])

  useEffect(() => {
    if (role === 'guest') return
    let last = partyRooms(useDungeonStore.getState().dungeon)
    let lastMap = useDungeonStore.getState().dungeon.id
    const quiet = new Map<string, number>()
    const timers = new Set<number>()

    const unsub = useDungeonStore.subscribe((state, prev) => {
      if (state.dungeon.players === prev.dungeon.players && state.dungeon.floors === prev.dungeon.floors) return
      const dungeon = state.dungeon
      const now = partyRooms(dungeon)
      // A new map isn't walking in anywhere.
      if (dungeon.id !== lastMap) {
        lastMap = dungeon.id
        last = now
        return
      }
      const entered = new Set<string>()
      for (const [playerId, place] of now) if (last.get(playerId) !== place) entered.add(place)
      last = now
      if (!entered.size) return
      const reminders = mapReminders(dungeon)
      const { notes, mapId } = useNotesStore.getState()
      for (const place of entered) {
        const [floorId, roomId] = place.split('\n')
        if (Date.now() - (quiet.get(place) ?? 0) < QUIET_MS) continue
        const here = reminders.filter((item) => item.roomId === roomId)
        const pinned = notes.filter((note) => note.anchor?.mapId === mapId && note.anchor?.roomId === roomId)
        const lines = [...here.map((item) => item.text), ...pinned.map((note) => `Note: ${noteTitle(note)}`)]
        if (!lines.length) continue
        quiet.set(place, Date.now())
        const room = dungeon.floors.find((floor) => floor.id === floorId)?.rooms.find((item) => item.id === roomId)
        const reminder: RoomReminder = { key: ++nextKey, floorId, roomId, roomName: room?.name ?? 'A room', lines }
        setShown((list) => [...list, reminder].slice(-MAX_SHOWN))
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          setShown((list) => list.filter((item) => item.key !== reminder.key))
        }, SHOW_MS)
        timers.add(timer)
      }
    })
    return () => {
      unsub()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [role])

  if (role === 'guest' || !shown.length) return null
  const dismiss = (key: number) => setShown((list) => list.filter((item) => item.key !== key))
  return (
    <div className="room-reminders" aria-live="polite">
      {shown.map((item) => (
        <div key={item.key} className="room-reminder panel" onPointerDown={(event) => event.stopPropagation()}>
          <div className="room-reminder-head">
            <Icon id="trap" size={14} className="is-gold" />
            <span className="kicker">Party entered {item.roomName}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(item.key)}>
              <Icon id="close" size={13} />
            </button>
          </div>
          <ul>
            {item.lines.slice(0, 5).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
            {item.lines.length > 5 ? <li className="is-more">and {item.lines.length - 5} more</li> : null}
          </ul>
          <div className="room-reminder-actions">
            <button
              type="button"
              className="text-btn"
              onClick={() => lookAtRoom(item.floorId, item.roomId)}
            >
              Look
            </button>
            <button type="button" className="text-btn" onClick={() => useNotesStore.getState().openPanel('reminders')}>
              Open notes
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
