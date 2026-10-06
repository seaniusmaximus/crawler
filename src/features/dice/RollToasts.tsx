import { useEffect, useState } from 'react'
import { playerTokenCenter, tokenStandee } from '../../canvas/pick.ts'
import { tokenForRoll } from '../../model/combat.ts'
import { readableFormula, rollAccent, rollBreakdown, type DiceRoll } from '../../model/dice.ts'
import { resolveFloor } from '../../model/floors.ts'
import { playerSize } from '../../model/players.ts'
import { onNewRolls, useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { tokenShown } from '../party/tokenInfo.ts'
import { TRAY_SPOT, whenLanded } from './landing.ts'
import { RollResult } from './RollResult.tsx'

const TOAST_MS = 4200
/** Gap between the top of the standee and the lowest toast. */
const LIFT = 10
const STACK = 46
/** Above the tray spot, clear of the dice landing beside it. */
const TRAY_LIFT = 70

interface Toast {
  roll: DiceRoll
}

/**
 * Every new roll, whatever made it (the tray, a token, the relay, D&D Beyond),
 * pops up with its result over the token it belongs to, or by the dice tray when
 * it has none or that token is on another floor. When dice are thrown, it waits
 * for them to land.
 */
export function RollToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
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

    // New rolls only, oldest first, so the latest lands on top; never the log a table hands over on join.
    const unsubscribe = onNewRolls((fresh) => {
      for (const roll of fresh) {
        const toast = { roll }
        // With no dice thrown (a D&D Beyond roll, or 3D dice off) this runs at once, before
        // whenLanded returns its cancel; only a toast still waiting keeps one.
        let waiting: (() => void) | null = null
        let shown = false
        const cancel = whenLanded(roll.id, () => {
          shown = true
          if (waiting) waits.delete(waiting)
          show(toast)
        })
        if (!shown) {
          waiting = cancel
          waits.add(cancel)
        }
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
  const rolls = useDiceStore((state) => state.rolls)
  const floor = resolveFloor(floors, activeFloorId)

  // Over its token when that token is in view here; by the tray when it has none or stands on
  // another floor; not at all for a token this viewer may not see (a hidden monster).
  // The token is looked up as the toast is drawn, from the log's copy of the roll, so a toast
  // moves to its token as soon as a later copy of the roll says whose it is.
  const anchored = toasts.flatMap((toast) => {
    const roll = rolls.find((item) => item.id === toast.roll.id) ?? toast.roll
    const token = tokenForRoll(roll, tokens)
    if (token && !tokenShown(token, floors, viewMode)) return []
    return [{ ...toast, token: token && token.floorId === floor.id ? token : undefined }]
  })
  // Toasts in the same place stack upward: the newest sits nearest.
  const stackIndex = new Map<string, number>()
  const placed = [...anchored].reverse().map((toast) => {
    const spot = toast.token?.id ?? 'tray'
    const index = stackIndex.get(spot) ?? 0
    stackIndex.set(spot, index + 1)
    return { ...toast, index }
  })

  return (
    <div className="roll-toasts" aria-live="polite">
      {placed.map(({ roll, token, index }) => {
        let left: number | string = TRAY_SPOT.left
        let top: number | string = `calc(100% - ${TRAY_SPOT.fromBottom + TRAY_LIFT + index * STACK}px)`
        let color: string | undefined
        if (token) {
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
              {/* Over a token, the token says who rolled; by the tray, the name does. */}
              <span className="roll-toast-title">
                {roll.character && !token ? `${roll.character} · ${roll.title}` : roll.title}
              </span>
              {note ? <span className="roll-toast-note">{note}</span> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}
