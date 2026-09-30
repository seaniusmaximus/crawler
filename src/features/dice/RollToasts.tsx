import { useEffect, useState } from 'react'
import { playerTokenCenter, tokenStandee } from '../../canvas/pick.ts'
import { playerForInitiativeRoll } from '../../model/combat.ts'
import { rollAccent, type DiceRoll } from '../../model/dice.ts'
import { resolveFloor } from '../../model/floors.ts'
import { playerSize } from '../../model/players.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { tokenShown } from '../party/tokenInfo.ts'

const TOAST_MS = 4200
/** Rolls older than this when they arrive are history (a table's backlog on join), not news. */
const FRESH_MS = 10000
/** Gap between the top of the standee and the lowest toast. */
const LIFT = 10
const STACK = 46

interface Toast {
  roll: DiceRoll
  playerId: string
}

/**
 * While the dice tray is closed, each new roll pops up briefly above the token
 * that made it, so results are not missed. Rolls with no token to point at,
 * such as plain tray rolls, stay in the tray only.
 */
export function RollToasts() {
  const trayOpen = useDiceStore((state) => state.open)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const seen = new Set(useDiceStore.getState().rolls.map((roll) => roll.id))
    const timers = new Set<number>()

    const unsubscribe = useDiceStore.subscribe((state) => {
      const fresh = state.rolls.filter((roll) => !seen.has(roll.id))
      for (const roll of fresh) seen.add(roll.id)
      if (fresh.length === 0 || state.open) return

      const tokens = useDungeonStore.getState().dungeon.players ?? []
      const now = Date.now()
      const next: Toast[] = []
      // The log is newest first; add oldest first so the latest lands on top.
      for (const roll of [...fresh].reverse()) {
        if (now - roll.at > FRESH_MS) continue
        const token = playerForInitiativeRoll(roll, tokens)
        if (token) next.push({ roll, playerId: token.id })
      }
      if (next.length === 0) return

      setToasts((current) => [...current, ...next])
      for (const toast of next) {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          setToasts((current) => current.filter((item) => item.roll.id !== toast.roll.id))
        }, TOAST_MS)
        timers.add(timer)
      }
    })

    return () => {
      unsubscribe()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  // Opening the tray shows the full log, so the pop-ups step aside.
  if (trayOpen || toasts.length === 0) return null
  return <ToastLayer toasts={toasts} />
}

/** Positions each toast over its token; mounted only while toasts exist, so the camera is not watched otherwise. */
function ToastLayer({ toasts }: { toasts: Toast[] }) {
  const camera = useEditorStore((state) => state.camera)
  const viewMode = useEditorStore((state) => state.viewMode)
  const activeFloorId = useEditorStore((state) => state.activeFloorId)
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const floor = resolveFloor(floors, activeFloorId)

  // Toasts for the same token stack upward: the newest sits nearest the token.
  const stackIndex = new Map<string, number>()
  const placed = [...toasts].reverse().map((toast) => {
    const index = stackIndex.get(toast.playerId) ?? 0
    stackIndex.set(toast.playerId, index + 1)
    return { ...toast, index }
  })

  return (
    <div className="roll-toasts" aria-live="polite">
      {placed.map(({ roll, playerId, index }) => {
        const token = tokens.find((item) => item.id === playerId)
        if (!token || token.floorId !== floor.id || !tokenShown(token, floors, viewMode)) return null
        const pos = playerTokenCenter(token, floor.rooms, floor.ramps ?? [], camera)
        const standee = tokenStandee(camera, playerSize(token))
        const accent = rollAccent(roll)
        const note = [roll.formula, accent === 'crit' ? 'Natural 20' : accent === 'fumble' ? 'Natural 1' : '']
          .filter(Boolean)
          .join(' · ')
        return (
          <div
            key={roll.id}
            className={`roll-toast${accent ? ` is-${accent}` : ''}`}
            role="status"
            style={{
              left: pos.x,
              top: pos.y - standee.height - LIFT - index * STACK,
              ['--token' as string]: token.color,
            }}
          >
            <span className="roll-toast-total">{roll.total}</span>
            <span className="roll-toast-copy">
              <span className="roll-toast-title">{roll.title}</span>
              {note ? <span className="roll-toast-note">{note}</span> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}
