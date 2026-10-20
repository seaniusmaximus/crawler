import { useEffect, useState } from 'react'
import {
  DIE_FACES,
  MAX_DIE_COUNT,
  formatModifier,
  readableFormula,
  rollAccent,
  rollBreakdown,
  type DiceRoll,
} from '../../model/dice.ts'
import { tokenForRoll } from '../../model/combat.ts'
import { characterNameOf } from '../../model/players.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Diamond, Divider, Icon } from '../../ui/Icon.tsx'
import { bridgeIcon } from '../../ui/brand.ts'
import { Stepper } from '../../ui/Stepper.tsx'
import { tokenShown } from '../party/tokenInfo.ts'
import { EXTENSION_URL, startDiceBridge } from './bridge.ts'
import { RollResult } from './RollResult.tsx'

// The extension announces itself within ~1s of the tray mounting; give it some slack.
const BRIDGE_GRACE_MS = 5000

export function DiceTray() {
  const open = useDiceStore((state) => state.open)
  const allRolls = useDiceStore((state) => state.rolls)
  const count = useDiceStore((state) => state.count)
  const modifier = useDiceStore((state) => state.modifier)
  const bridge = useDiceStore((state) => state.bridge)
  const bridgeSeen = useDiceStore((state) => state.bridgeSeen)
  const viewMode = useEditorStore((state) => state.viewMode)
  const guest = useSessionStore((state) => state.role === 'guest')
  const physical = useDiceStore((state) => state.physical)
  // A player's tray rolls are theirs: named for their token, so they show (and land) beside it.
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const myToken = useDungeonStore((state) =>
    guest && myPlayerId ? (state.dungeon.players ?? []).find((player) => player.id === myPlayerId) : undefined,
  )
  const who = myToken
    ? { character: characterNameOf(myToken), characterId: myToken.characterId ?? undefined, tokenId: myToken.id }
    : undefined
  const [faces, setFaces] = useState<number>(20)
  const [graceOver, setGraceOver] = useState(false)
  const tokens = useDungeonStore((state) => state.dungeon.players)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  // Players never see a roll for a token they can't see, such as a hidden monster's initiative.
  const rolls = allRolls.filter((roll) => {
    const token = tokenForRoll(roll, tokens ?? [])
    return !token || tokenShown(token, floors, tokens ?? [], viewMode)
  })
  const latest = rolls[0] ?? null

  useEffect(() => startDiceBridge(), [])
  useEffect(() => {
    const timer = window.setTimeout(() => setGraceOver(true), BRIDGE_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const dice = useDiceStore.getState()
  const formula = `${count}d${faces}${modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : ''}`

  return (
    <div className="dice-dock" data-dice-tray="1">
      {open ? (
        // Dressed like the Maps and Save chests' panels, opening in the same place above the row.
        <section className="panel save-panel chest-panel dice-panel" aria-label="Dice">
          <div className="panel-body dice-panel-body">
            <header className="panel-head">
              <h2 className="panel-title">
                <Diamond />
                <span>Dice</span>
                <span
                  className={`bridge-pip${bridge === 'connected' ? ' is-on' : ''}`}
                  title={bridge === 'connected' ? 'D&D Beyond bridge connected' : 'D&D Beyond bridge not connected'}
                />
              </h2>
              <span className="dice-head-end">
                {graceOver && !bridgeSeen ? (
                  <a
                    className="bridge-link"
                    href={EXTENSION_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Install the Crawler Dice Bridge extension to send D&D Beyond rolls here"
                  >
                    <img className="bridge-icon" src={bridgeIcon} width={16} height={16} alt="" />
                    Get Bridge
                    <Icon id="external" size={12} />
                  </a>
                ) : (
                  <span className="panel-meta">Rolls sync to the table</span>
                )}
                <button type="button" className="icon-btn is-boxed" aria-label="Close" onClick={() => dice.setOpen(false)}>
                  <Icon id="close" size={15} />
                </button>
              </span>
            </header>

            <div className="die-grid" role="group" aria-label="Die">
              {DIE_FACES.map((face) => (
                <button
                  key={face}
                  type="button"
                  className={`die-pick${face === faces ? ' is-active' : ''}`}
                  aria-pressed={face === faces}
                  onClick={() => setFaces(face)}
                >
                  <Icon id={`d${face}`} size={24} strokeWidth={1.4} />
                  <span>d{face}</span>
                </button>
              ))}
            </div>

            <div className="dice-steppers">
              <Stepper
                label="Count"
                value={`${count}`}
                onDown={() => dice.setCount(count - 1)}
                onUp={() => dice.setCount(count + 1)}
                downDisabled={count <= 1}
                upDisabled={count >= MAX_DIE_COUNT}
              />
              <Stepper
                label="Mod"
                value={formatModifier(modifier) || '0'}
                onDown={() => dice.setModifier(modifier - 1)}
                onUp={() => dice.setModifier(modifier + 1)}
              />
            </div>

            <button type="button" className="roll-btn" onClick={() => dice.roll(faces, who)}>
              ROLL {formula}
            </button>

            <label className="dice-physical">
              <input type="checkbox" checked={physical} onChange={(event) => dice.setPhysical(event.target.checked)} />
              Throw dice on the table
            </label>

            {rolls.length > 0 ? (
              <>
                <Divider />
                <div className="dice-log-head">
                  <span className="kicker">Recent</span>
                  <button type="button" className="text-btn" onClick={() => dice.clear()}>
                    Clear
                  </button>
                </div>
                <ol className="dice-log">
                  {rolls.map((roll) => (
                    <RollRow key={roll.id} roll={roll} />
                  ))}
                </ol>
              </>
            ) : (
              <p className="panel-empty">Roll here, or from a D&amp;D Beyond sheet</p>
            )}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className={`panel chest-fab chest${open ? ' is-open' : ''}`}
        onClick={() => dice.setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Close dice tray' : 'Open dice tray'}
        title="Dice tray"
      >
        <Icon id="d20" size={24} strokeWidth={1.3} className="is-gold" />
        <span className="chest-fab-copy">
          <span className="chest-fab-state">Dice</span>
          {/* The latest roll at a glance; until there is one, what the chest is for. */}
          {latest ? (
            <span className="chest-fab-name">
              Last roll: <RollResult roll={latest} className="dice-fab-total" compact />
            </span>
          ) : (
            <span className="chest-fab-name">Roll</span>
          )}
        </span>
      </button>
    </div>
  )
}

function RollRow({ roll }: { roll: DiceRoll }) {
  const color = useDungeonStore((state) => {
    const tokens = state.dungeon.players ?? []
    const owner =
      tokens.find((token) => roll.characterId && token.characterId === roll.characterId) ??
      tokens.find((token) => roll.character && characterNameOf(token) === roll.character)
    return owner?.color ?? null
  })
  const atTable = useSessionStore((state) => state.role !== 'solo')
  // d20s shown one by one colour their own 20s and 1s, so the note needn't call them out.
  const accent = rollBreakdown(roll).kind === 'each' ? null : rollAccent(roll)
  // Table rolls are made by the relay; say where any other roll came from.
  const origin = roll.source === 'ddb' ? 'via D&D Beyond' : roll.source === 'local' && atTable ? 'offline, not shared' : ''
  const note = [
    roll.character ? roll.title : '',
    readableFormula(roll),
    accent === 'crit' ? 'Natural 20' : accent === 'fumble' ? 'Natural 1' : '',
    origin,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="dice-log-item">
      <span className="roll-dot" style={color ? { background: color } : undefined} />
      <span className="roll-copy">
        <span className="roll-who">{roll.character || roll.title}</span>
        <span className="roll-note">{note}</span>
      </span>
      <RollResult roll={roll} className="roll-total" />
    </li>
  )
}
