import { useEffect, useRef } from 'react'
import { playerTokenCenter } from '../../canvas/pick.ts'
import { tokenForRoll } from '../../model/combat.ts'
import type { DiceRoll } from '../../model/dice.ts'
import { resolveFloor } from '../../model/floors.ts'
import { onNewRolls, useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { tokenShown } from '../party/tokenInfo.ts'
import { markLanded, markThrown, TRAY_SPOT } from './landing.ts'
import type { DiceScene, ThrowDie } from './three/scene.ts'
import type { DieKind } from './three/shapes.ts'

const NEUTRAL = '#e3bf6a'

const count = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(i + from))
const LABELS: Record<DieKind, string[]> = {
  d4: count(4),
  d6: count(6),
  d8: count(8),
  d10: count(10),
  d12: count(12),
  d20: count(20),
}
/** A d100 is thrown as a pair of d10s: tens (00–90) and units (0–9). 100 reads "00" and "0". */
const TENS = count(10, 0).map((n) => `${n}0`)
const UNITS = count(10, 0)

/** The physical dice for a roll; dice of unusual sizes (a d3, a d1000) aren't thrown. */
function diceFor(roll: DiceRoll): ThrowDie[] {
  const dice: ThrowDie[] = []
  for (const die of roll.dice) {
    const discarded = Boolean(die.discarded)
    if (die.faces === 100) {
      const tens = Math.floor((die.value % 100) / 10)
      dice.push({ kind: 'd10', labels: TENS, result: TENS[tens], discarded, accent: null })
      dice.push({ kind: 'd10', labels: UNITS, result: String(die.value % 10), discarded, accent: null })
      continue
    }
    const kind = `d${die.faces}` as DieKind
    if (!(kind in LABELS)) continue
    const accent = kind === 'd20' && !discarded ? (die.value === 20 ? 'crit' : die.value === 1 ? 'fumble' : null) : null
    dice.push({ kind, labels: LABELS[kind], result: String(die.value), discarded, accent })
  }
  return dice
}

/**
 * Each roll also tumbles across the table as real 3D dice in the roller's colour,
 * beside their token (or by the dice tray when no token rolled). The results are
 * the roll's own; the dice act them out. The 3D engine loads with the first roll.
 * Off with the tray's switch.
 */
export function PhysicalDice() {
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let scene: DiceScene | null = null
    let loading: Promise<DiceScene> | null = null
    let disposed = false
    const ready = (): Promise<DiceScene> =>
      (loading ??= import('./three/scene.ts').then(({ DiceScene }) => {
        if (disposed || !stage.current) throw new Error('gone')
        scene = new DiceScene(stage.current)
        return scene
      }))

    /** Where a throw stands each frame: its token (following the camera), or the tray spot. */
    const anchorFor = (playerId: string | null) => () => {
      if (!playerId) return { x: TRAY_SPOT.left, y: (stage.current?.clientHeight ?? window.innerHeight) - TRAY_SPOT.fromBottom }
      const { dungeon } = useDungeonStore.getState()
      const { camera, activeFloorId } = useEditorStore.getState()
      const floor = resolveFloor(dungeon.floors, activeFloorId)
      const token = (dungeon.players ?? []).find((player) => player.id === playerId)
      if (!token || token.floorId !== floor.id) return null
      return playerTokenCenter(token, floor.rooms, floor.ramps ?? [], camera)
    }

    const unsubscribe = onNewRolls((fresh) => {
      if (!useDiceStore.getState().physical) return
      const tokens = useDungeonStore.getState().dungeon.players ?? []
      const floors = useDungeonStore.getState().dungeon.floors
      for (const roll of fresh) {
        const dice = diceFor(roll)
        if (dice.length === 0) continue
        const token = tokenForRoll(roll, tokens)
        // A roll for a token players can't see (a hidden monster) throws no dice on any screen;
        // the DM still has its result in the log.
        if (token && !tokenShown(token, floors, tokens, 'player')) continue
        markThrown(roll.id)
        void ready().then(
          (table) =>
            table.throw({
              dice,
              color: token?.color ?? NEUTRAL,
              // From a token, toward the viewer so they land in front of it; from the tray spot, to the right.
              aim: token ? Math.PI / 2 : 0,
              anchor: anchorFor(token?.id ?? null),
              onSettled: () => markLanded(roll.id),
            }),
          () => markLanded(roll.id),
        )
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      scene?.dispose()
    }
  }, [])

  return <div ref={stage} className="dice-stage" aria-hidden />
}
