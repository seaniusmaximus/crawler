import { useEffect, useState, type FormEvent } from 'react'
import { useDiceStore } from '../../state/diceStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { DDB_CHARACTERS_URL, EXTENSION_URL, requestDdbCharacter } from '../dice/bridge.ts'

// The extension says hello every few seconds; wait that long before calling it missing.
const BRIDGE_GRACE_MS = 4000

type Step = 'choose' | 'ddb' | 'native'

/** Asks a joining player whether to bring a D&D Beyond character or play a Crawler one. */
export function SeatPrompt() {
  const open = useSessionStore((state) => state.role === 'guest' && state.seatPrompt)
  return open ? <SeatDialog /> : null
}

function SeatDialog() {
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [graceOver, setGraceOver] = useState(false)
  const bridge = useDiceStore((state) => state.bridge)
  const session = useSessionStore.getState()
  const close = (): void => session.setSeatPrompt(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setGraceOver(true), BRIDGE_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') useSessionStore.getState().setSeatPrompt(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep asking while we wait: a sheet opened after the first request answers the next one.
  useEffect(() => {
    if (step !== 'ddb') return
    const timer = window.setInterval(requestDdbCharacter, 3000)
    return () => window.clearInterval(timer)
  }, [step])

  function pickDdb(): void {
    setStep('ddb')
    session.chooseSeat({ mode: 'ddb' })
  }

  function pickNative(event: FormEvent): void {
    event.preventDefault()
    session.chooseSeat({ mode: 'native', name: name.trim() })
    close()
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog seat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="seat-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {step === 'choose' ? (
          <>
            <h2 id="seat-title">Join the table</h2>
            <p>Who are you playing?</p>
            <div className="seat-options">
              <button type="button" className="seat-option" onClick={pickDdb}>
                <Icon id="d20" size={22} strokeWidth={1.3} className="is-gold" />
                <span className="seat-option-copy">
                  <span className="seat-option-title">D&amp;D Beyond character</span>
                  <span className="seat-option-note">Portrait, stats and rolls come from your sheet</span>
                </span>
              </button>
              <button type="button" className="seat-option" onClick={() => setStep('native')}>
                <Icon id="person" size={22} className="is-gold" />
                <span className="seat-option-copy">
                  <span className="seat-option-title">Crawler character</span>
                  <span className="seat-option-note">A token on the map you move yourself</span>
                </span>
              </button>
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-button" onClick={close}>
                Just watch
              </button>
            </div>
          </>
        ) : null}

        {step === 'native' ? (
          <form onSubmit={pickNative}>
            <h2 id="seat-title">Crawler character</h2>
            <p>Name your character. You can leave it blank and pick one later.</p>
            <input
              className="field seat-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Character name"
              aria-label="Character name"
              maxLength={40}
              autoFocus
            />
            <div className="dialog-actions">
              <button type="button" className="dialog-button" onClick={() => setStep('choose')}>
                Back
              </button>
              <button type="submit" className="dialog-button is-primary">
                Take a seat
              </button>
            </div>
          </form>
        ) : null}

        {step === 'ddb' ? (
          <>
            <h2 id="seat-title">D&amp;D Beyond character</h2>
            {bridge === 'connected' ? (
              <p>
                The Crawler extension is connected. Open your character sheet on D&amp;D Beyond and Crawler picks it
                up automatically.
              </p>
            ) : graceOver ? (
              <>
                <p>Crawler can&apos;t find its browser extension. To bring your character in:</p>
                <ol className="dialog-list seat-steps">
                  <li>
                    Install the{' '}
                    <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer">
                      Crawler Dice Bridge
                    </a>{' '}
                    extension, or turn it back on.
                  </li>
                  <li>Reload this page.</li>
                  <li>Open your character sheet on D&amp;D Beyond.</li>
                </ol>
              </>
            ) : (
              <p>Looking for the Crawler extension…</p>
            )}
            <p className="seat-waiting">
              <span className="status-pip" />
              Waiting for your character sheet
            </p>
            <div className="dialog-actions">
              <button type="button" className="dialog-button" onClick={() => setStep('choose')}>
                Back
              </button>
              {bridge !== 'connected' && graceOver ? (
                <a className="dialog-button" href={EXTENSION_URL} target="_blank" rel="noopener noreferrer">
                  Get the extension
                  <Icon id="external" size={12} />
                </a>
              ) : null}
              <a className="dialog-button is-primary" href={DDB_CHARACTERS_URL} target="_blank" rel="noopener noreferrer">
                Open D&amp;D Beyond
                <Icon id="external" size={12} />
              </a>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
