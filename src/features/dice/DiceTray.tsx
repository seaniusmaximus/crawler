import { useEffect, useState } from 'react'
import { DIE_FACES, MAX_DIE_COUNT, formatModifier, rollAccent, type DiceRoll } from '../../model/dice.ts'
import { characterNameOf } from '../../model/players.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Diamond, Divider, Icon } from '../../ui/Icon.tsx'
import { startDiceBridge } from './bridge.ts'

const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/crawler-dice-bridge/bpgbfbpckmbljndpmoncdjpeniepplbb'
// The extension announces itself within ~1s of the tray mounting; give it some slack.
const BRIDGE_GRACE_MS = 5000

export function DiceTray() {
  const open = useDiceStore((state) => state.open)
  const rolls = useDiceStore((state) => state.rolls)
  const count = useDiceStore((state) => state.count)
  const modifier = useDiceStore((state) => state.modifier)
  const bridge = useDiceStore((state) => state.bridge)
  const bridgeSeen = useDiceStore((state) => state.bridgeSeen)
  const viewMode = useEditorStore((state) => state.viewMode)
  const guest = useSessionStore((state) => state.role === 'guest')
  const [faces, setFaces] = useState<number>(20)
  const [graceOver, setGraceOver] = useState(false)
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
        <section className="panel dice-panel" aria-label="Dice">
          <header className="panel-head">
            <h2 className="panel-title">
              <Diamond />
              <span>Dice</span>
              <span
                className={`bridge-pip${bridge === 'connected' ? ' is-on' : ''}`}
                title={bridge === 'connected' ? 'D&D Beyond bridge connected' : 'D&D Beyond bridge not connected'}
              />
            </h2>
            {graceOver && !bridgeSeen ? (
              <a
                className="bridge-link"
                href={EXTENSION_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Install the Crawler Dice Bridge extension to send D&D Beyond rolls here"
              >
                Get Bridge
                <Icon id="external" size={12} />
              </a>
            ) : (
              <span className="panel-meta">Rolls sync to the table</span>
            )}
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

          <button type="button" className="roll-btn" onClick={() => dice.roll(faces)}>
            ROLL {formula}
          </button>

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
        </section>
      ) : null}

      <button
        type="button"
        className={`panel dice-fab${open ? ' is-open' : ''}`}
        onClick={() => dice.setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Close dice tray' : 'Open dice tray'}
        title="Dice tray"
      >
        <Icon id="d20" size={26} strokeWidth={1.3} className="is-gold" />
        {viewMode === 'player' || guest ? <span>Roll</span> : null}
        {!open && latest ? <span className={`dice-fab-total${accentClass(latest)}`}>{latest.total}</span> : null}
      </button>
    </div>
  )
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
  downDisabled,
  upDisabled,
}: {
  label: string
  value: string
  onDown: () => void
  onUp: () => void
  downDisabled?: boolean
  upDisabled?: boolean
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" aria-label={`Decrease ${label}`} onClick={onDown} disabled={downDisabled}>
          <Icon id="minus" size={13} />
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" aria-label={`Increase ${label}`} onClick={onUp} disabled={upDisabled}>
          <Icon id="plus" size={13} />
        </button>
      </div>
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
  const accent = rollAccent(roll)
  const note = [
    roll.character ? roll.title : '',
    roll.formula,
    accent === 'crit' ? 'Natural 20' : accent === 'fumble' ? 'Natural 1' : '',
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
      <span className={`roll-total${accentClass(roll)}`}>{roll.total}</span>
    </li>
  )
}

function accentClass(roll: DiceRoll): string {
  const accent = rollAccent(roll)
  return accent ? ` is-${accent}` : ''
}
