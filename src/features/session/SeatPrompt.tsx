import { useEffect, useState, type FormEvent } from 'react'
import { characterNameOf, isMonster } from '../../model/players.ts'
import type { Player } from '../../model/types.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { myClientId, useSessionStore } from '../../state/sessionStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { bridgeIcon } from '../../ui/brand.ts'
import { DDB_CHARACTERS_URL, EXTENSION_URL, requestDdbCharacter } from '../dice/bridge.ts'

// The extension says hello every few seconds; wait that long before calling it missing.
const BRIDGE_GRACE_MS = 4000

type Step = 'choose' | 'ddb' | 'native' | 'returning'

/** Tokens held by another player who is connected right now. */
function useHeldTokens(): Set<string> {
  const claims = useSessionStore((state) => state.claims)
  const present = useSessionStore((state) => state.presentGuests)
  const me = myClientId()
  return new Set(
    Object.entries(claims)
      .filter(([id, playerId]) => playerId && id !== me && present.includes(id))
      .map(([, playerId]) => playerId as string),
  )
}

/** Party tokens nobody at the table is holding: the ones a returning player could take back. */
function useOpenTokens(held: Set<string>): Player[] {
  const players = useDungeonStore((state) => state.dungeon.players)
  return (players ?? []).filter((player) => !isMonster(player) && !held.has(player.id))
}

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
  const held = useHeldTokens()
  const open = useOpenTokens(held)
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
        className="dialog seat-dialog scroll-v"
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
              {open.length ? (
                <button type="button" className="seat-option" onClick={() => setStep('returning')}>
                  <Icon id="link" size={22} className="is-gold" />
                  <span className="seat-option-copy">
                    <span className="seat-option-title">I&apos;ve played here before</span>
                    <span className="seat-option-note">Take back a character already on the map</span>
                  </span>
                </button>
              ) : null}
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-button" onClick={close}>
                Just watch
              </button>
            </div>
          </>
        ) : null}

        {step === 'returning' ? <ReturningStep tokens={open} held={held} onBack={() => setStep('choose')} /> : null}

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
                  <img className="bridge-icon" src={bridgeIcon} width={16} height={16} alt="" />
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

/** Pick an existing party token; the DM's browser confirms it, or refuses if it was just taken. */
function ReturningStep({ tokens, held, onBack }: { tokens: Player[]; held: Set<string>; onBack: () => void }) {
  const [picked, setPicked] = useState<Player | null>(null)
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const hostOnline = useSessionStore((state) => state.hostOnline)
  const sheetId = useSessionStore((state) => state.character?.characterId ?? null)
  const bridge = useDiceStore((state) => state.bridge)
  const refused = picked !== null && held.has(picked.id)
  const seated = picked !== null && myPlayerId === picked.id
  // A token that came from D&D Beyond is only fully back once its sheet is syncing again.
  const needsSheet = Boolean(picked?.characterId) && sheetId !== picked?.characterId
  const waiting = picked !== null && !refused && !seated

  useEffect(() => {
    if (seated && !needsSheet) useSessionStore.getState().setSeatPrompt(false)
  }, [seated, needsSheet])

  // Keep asking the extension while waiting: a sheet opened later answers the next request.
  useEffect(() => {
    if (!seated || !needsSheet) return
    const timer = window.setInterval(requestDdbCharacter, 3000)
    return () => window.clearInterval(timer)
  }, [seated, needsSheet])

  function take(token: Player): void {
    setPicked(token)
    useSessionStore.getState().chooseSeat({
      mode: 'native',
      name: characterNameOf(token),
      playerId: token.id,
      characterId: token.characterId ?? null,
    })
  }

  if (seated && needsSheet && picked) {
    const name = characterNameOf(picked)
    return (
      <>
        <h2 id="seat-title">You&apos;re back as {name}</h2>
        {bridge === 'connected' ? (
          <p>Open {name}&apos;s character sheet on D&amp;D Beyond to sync stats, portrait and rolls again.</p>
        ) : (
          <>
            <p>{name} came from D&amp;D Beyond. To sync stats, portrait and rolls again:</p>
            <ol className="dialog-list seat-steps">
              <li>
                Install the{' '}
                <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer">
                  Crawler Dice Bridge
                </a>{' '}
                extension, or turn it back on.
              </li>
              <li>Reload this page. You&apos;ll keep your seat.</li>
              <li>Open {name}&apos;s character sheet on D&amp;D Beyond.</li>
            </ol>
          </>
        )}
        <p className="seat-waiting">
          <span className="status-pip" />
          Waiting for {name}&apos;s sheet
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="dialog-button"
            onClick={() => useSessionStore.getState().setSeatPrompt(false)}
          >
            Skip for now
          </button>
          <a className="dialog-button is-primary" href={DDB_CHARACTERS_URL} target="_blank" rel="noopener noreferrer">
            Open D&amp;D Beyond
            <Icon id="external" size={12} />
          </a>
        </div>
      </>
    )
  }

  if (waiting) {
    return (
      <>
        <h2 id="seat-title">Taking your seat</h2>
        <p>
          {hostOnline
            ? `Asking the DM for ${characterNameOf(picked)}…`
            : `The DM isn't here yet. You'll be seated as ${characterNameOf(picked)} when they arrive.`}
        </p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={() => setPicked(null)}>
            Pick someone else
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <h2 id="seat-title">Welcome back</h2>
      <p>Which character is yours? Characters another player is using right now aren&apos;t listed.</p>
      {refused ? (
        <p className="panel-note is-error">Someone else just took {characterNameOf(picked)}. Pick another.</p>
      ) : null}
      {tokens.length ? (
        <ul className="seat-tokens">
          {tokens.map((token) => (
            <li key={token.id}>
              <button type="button" className="seat-option" onClick={() => take(token)}>
                <Avatar player={token} size={32} />
                <span className="seat-option-copy">
                  <span className="seat-option-title">{characterNameOf(token)}</span>
                  {token.name && token.name !== characterNameOf(token) ? (
                    <span className="seat-option-note">{token.name}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">Every character on the map is taken right now.</p>
      )}
      <div className="dialog-actions">
        <button type="button" className="dialog-button" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  )
}
