import { useEffect, useState } from 'react'
import { playerTokenCenter, tokenStandee } from '../../canvas/pick.ts'
import { playerForInitiativeRoll } from '../../model/combat.ts'
import { readableFormula, rollAccent, rollBreakdown, type DiceRoll } from '../../model/dice.ts'
import { resolveFloor } from '../../model/floors.ts'
import { playerSize } from '../../model/players.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { tokenShown } from '../party/tokenInfo.ts'
import { TRAY_SPOT, whenLanded } from './landing.ts'
import { RollResult } from './RollResult.tsx'

const TOAST_MS = 4200
/** Rolls older than this when they arrive are history (a table's backlog on join), not news. */
const FRESH_MS = 10000
/** Gap between the top of the standee and the lowest toast. */
const LIFT = 10
const STACK = 46
/** Above the tray spot, clear of the dice landing beside it. */
const TRAY_LIFT = 70

interface Toast {
  roll: DiceRoll
  /** The token it pops up over, or null for the tray spot. */
  playerId: string | null
}

/**
 * Each new roll pops up with its result: over the token that made it, or by the
 * dice tray when no token rolled. When dice are thrown, it waits for them to land.
 */
export function RollToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const seen = new Set(useDiceStore.getState().rolls.map((roll) => roll.id))
    const timers = new Set<number>()
    const waits = new Set<() => void>()

    const show = (toast: Toast) => {
      setToasts((current) => [...current, toast])
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        setToasts((current) => current.filter((item) => item.roll.id !== toast.roll.id))
      }, TOAST_MS)
      timers.add(timer)
    }

    const unsubscribe = useDiceStore.subscribe((state) => {
      const fresh = state.rolls.filter((roll) => !seen.has(roll.id))
      for (const roll of fresh) seen.add(roll.id)
      if (fresh.length === 0) return
      const tokens = useDungeonStore.getState().dungeon.players ?? []
      const now = Date.now()
      // The log is newest first; queue oldest first so the latest lands on top.
      for (const roll of [...fresh].reverse()) {
        if (now - roll.at > FRESH_MS) continue
        const toast = { roll, playerId: playerForInitiativeRoll(roll, tokens)?.id ?? null }
        const cancel = whenLanded(roll.id, () => {
          waits.delete(cancel)
          show(toast)
        })
        waits.add(cancel)
      }
    })

    return () => {
      unsubscribe()
      for (const timer of timers) window.clearTimeout(timer)
      for (const cancel of waits) cancel()
    }
  }, [])

  if (toasts.length === 0) return null
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

  // Toasts in the same place stack upward: the newest sits nearest.
  const stackIndex = new Map<string, number>()
  const placed = [...toasts].reverse().map((toast) => {
    const spot = toast.playerId ?? 'tray'
    const index = stackIndex.get(spot) ?? 0
    stackIndex.set(spot, index + 1)
    return { ...toast, index }
  })

  return (
    <div className="roll-toasts" aria-live="polite">
      {placed.map(({ roll, playerId, index }) => {
        let left: number | string = TRAY_SPOT.left
        let top: number | string = `calc(100% - ${TRAY_SPOT.fromBottom + TRAY_LIFT + index * STACK}px)`
        let color: string | undefined
        if (playerId) {
          const token = tokens.find((item) => item.id === playerId)
          if (!token || token.floorId !== floor.id || !tokenShown(token, floors, viewMode)) return null
          const pos = playerTokenCenter(token, floor.rooms, floor.ramps ?? [], camera)
          const standee = tokenStandee(camera, playerSize(token))
          left = pos.x
          top = pos.y - standee.height - LIFT - index * STACK
          color = token.color
        }
        // d20s read one by one colour each 20 and 1 themselves; the toast as a whole only otherwise.
        const accent = rollBreakdown(roll).kind === 'each' ? null : rollAccent(roll)
        const note = [readableFormula(roll), accent === 'crit' ? 'Natural 20' : accent === 'fumble' ? 'Natural 1' : '']
          .filter(Boolean)
          .join(' · ')
        return (
          <div
            key={roll.id}
            className={`roll-toast${accent ? ` is-${accent}` : ''}`}
            role="status"
            style={{ left, top, ...(color ? { ['--token' as string]: color } : {}) }}
          >
            <RollResult roll={roll} className="roll-toast-total" />
            <span className="roll-toast-copy">
              <span className="roll-toast-title">{roll.character ? `${roll.character} · ${roll.title}` : roll.title}</span>
              {note ? <span className="roll-toast-note">{note}</span> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}
