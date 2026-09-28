import { useEffect } from 'react'
import { DIE_FACES, formatModifier, rollAccent, type DiceRoll } from '../../model/dice.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { startDiceBridge } from './bridge.ts'

export function DiceTray() {
  const open = useDiceStore((state) => state.open)
  const help = useDiceStore((state) => state.help)
  const rolls = useDiceStore((state) => state.rolls)
  const count = useDiceStore((state) => state.count)
  const modifier = useDiceStore((state) => state.modifier)
  const bridge = useDiceStore((state) => state.bridge)
  const latest = rolls[0] ?? null

  useEffect(() => startDiceBridge(), [])

  return (
    <aside className={`dice-tray${open ? '' : ' is-collapsed'}`} data-dice-tray="1">
      <header className="dice-head">
        <button
          type="button"
          className="dice-toggle"
          onClick={() => useDiceStore.getState().setOpen(!open)}
          aria-expanded={open}
        >
          <span className={`dice-pip${bridge === 'connected' ? ' is-on' : ''}`} />
          Dice
          {!open && latest ? <span className="dice-mini-total">{latest.total}</span> : null}
        </button>
        {open ? (
          <div className="dice-head-actions">
            <button
              type="button"
              className={`dice-text-btn${help ? ' is-active' : ''}`}
              onClick={() => useDiceStore.getState().setHelp(!help)}
            >
              DDB
            </button>
            {rolls.length > 0 ? (
              <button type="button" className="dice-text-btn" onClick={() => useDiceStore.getState().clear()}>
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {open ? (
        <div className="dice-body">
          {help ? <BridgeHelp connected={bridge === 'connected'} /> : null}

          <div className="dice-faces" role="group" aria-label="Dice">
            {DIE_FACES.map((faces) => (
              <button
                key={faces}
                type="button"
                className="dice-face"
                onClick={() => useDiceStore.getState().roll(faces)}
              >
                d{faces}
              </button>
            ))}
          </div>

          <div className="dice-opts">
            <label className="dice-opt">
              <span>Count</span>
              <input
                type="number"
                min={1}
                max={12}
                value={count}
                onChange={(event) => useDiceStore.getState().setCount(Number(event.target.value))}
              />
            </label>
            <label className="dice-opt">
              <span>Mod</span>
              <input
                type="number"
                min={-30}
                max={30}
                value={modifier}
                onChange={(event) => useDiceStore.getState().setModifier(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="dice-results">
            {latest ? <LatestRoll roll={latest} /> : <p className="dice-empty">Roll here, or from a D&D Beyond sheet</p>}

            {rolls.length > 1 ? (
              <ol className="dice-log">
                {rolls.slice(1).map((roll) => (
                  <li key={roll.id} className="dice-log-item">
                    <span className={`dice-log-total${accentClass(roll)}`}>{roll.total}</span>
                    <span className="dice-log-copy">
                      <strong>{roll.title}</strong>
                      <em>
                        {roll.character ? `${roll.character} · ` : ''}
                        {roll.formula}
                      </em>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function LatestRoll({ roll }: { roll: DiceRoll }) {
  const kept = roll.dice.filter((die) => !die.discarded)
  return (
    <div className="dice-latest">
      <p className={`dice-latest-total${accentClass(roll)}`}>{roll.total}</p>
      <p className="dice-latest-title">
        {roll.character ? `${roll.character} · ` : ''}
        {roll.title}
        {roll.kind ? ` · ${roll.kind}` : ''}
      </p>
      <p className="dice-latest-formula">
        {kept.map((die, index) => (
          <span key={`${die.faces}-${index}`} className="dice-chip">
            d{die.faces}:{die.value}
          </span>
        ))}
        {roll.modifier ? <span className="dice-chip is-mod">{formatModifier(roll.modifier)}</span> : null}
        {!roll.dice.length ? <span className="dice-chip">{roll.formula}</span> : null}
      </p>
    </div>
  )
}

function BridgeHelp({ connected }: { connected: boolean }) {
  return (
    <div className="dice-help">
      <p>
        <strong>{connected ? 'Extension connected.' : 'Waiting for the Chrome extension.'}</strong>
      </p>
      <ol>
        <li>
          Open <code>chrome://extensions</code>
        </li>
        <li>Turn on Developer mode</li>
        <li>
          Load unpacked and choose this repo&apos;s <code>extension</code> folder
        </li>
        <li>Keep this tab open, then roll on a D&D Beyond character sheet</li>
      </ol>
      <p>The pip turns green when this tab is talking to the extension.</p>
    </div>
  )
}

function accentClass(roll: DiceRoll): string {
  const accent = rollAccent(roll)
  return accent ? ` is-${accent}` : ''
}
