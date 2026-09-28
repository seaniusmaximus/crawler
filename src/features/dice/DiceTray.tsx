import { useEffect } from 'react'
import { DIE_FACES, formatModifier, rollAccent, type DiceRoll } from '../../model/dice.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { startDiceBridge } from './bridge.ts'

export function DiceTray() {
  const open = useDiceStore((state) => state.open)
  const rolls = useDiceStore((state) => state.rolls)
  const count = useDiceStore((state) => state.count)
  const modifier = useDiceStore((state) => state.modifier)
  const bridge = useDiceStore((state) => state.bridge)
  const latest = rolls[0] ?? null

  useEffect(() => startDiceBridge(), [])

  return (
    <aside className={`dice-tray${open ? '' : ' is-collapsed'}`} data-dice-tray="1">
      <div className="dice-tabs">
        <button
          type="button"
          className="dice-tab"
          onClick={() => useDiceStore.getState().setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Collapse dice tray' : 'Expand dice tray'}
        >
          <span className={`dice-pip${bridge === 'connected' ? ' is-on' : ''}`} />
          <span className="dice-tab-label">Dice</span>
          {!open && latest ? <span className="dice-mini-total">{latest.total}</span> : null}
          <span className="dice-tab-caret" aria-hidden="true">
            {open ? '‹' : '›'}
          </span>
        </button>
        {rolls.length > 0 ? (
          <button
            type="button"
            className="dice-tab"
            onClick={() => useDiceStore.getState().clear()}
          >
            <span className="dice-tab-label">Clear</span>
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="dice-body">
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

function accentClass(roll: DiceRoll): string {
  const accent = rollAccent(roll)
  return accent ? ` is-${accent}` : ''
}
