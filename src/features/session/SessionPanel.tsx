import { useEffect, useState } from 'react'
import { bootSessionFromUrl, useSessionStore } from '../../state/sessionStore.ts'

export function SessionPanel() {
  const role = useSessionStore((state) => state.role)
  const status = useSessionStore((state) => state.status)
  const link = useSessionStore((state) => state.link)
  const links = useSessionStore((state) => state.links)
  const roomId = useSessionStore((state) => state.roomId)
  const peers = useSessionStore((state) => state.peers)
  const error = useSessionStore((state) => state.error)
  const character = useSessionStore((state) => state.character)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')

  useEffect(() => {
    bootSessionFromUrl()
  }, [])

  async function copy(value = link): Promise<void> {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="session">
      <header className="session-head">
        <span>Table</span>
        <span className={`session-pip${status === 'live' ? ' is-on' : ''}${status === 'error' ? ' is-err' : ''}`} />
      </header>

      {role === 'solo' ? (
        <div className="session-actions">
          <button type="button" className="session-btn" onClick={() => useSessionStore.getState().startHost()}>
            Host table
          </button>
          <form
            className="session-join"
            onSubmit={(event) => {
              event.preventDefault()
              useSessionStore.getState().join(code)
            }}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Join link"
              aria-label="Join link"
            />
            <button type="submit" className="session-btn">
              Join
            </button>
          </form>
        </div>
      ) : (
        <div className="session-live">
          <p className="session-status">
            {status === 'connecting'
              ? 'Connecting…'
              : role === 'host'
                ? `Hosting · ${peers.length} connected`
                : 'Connected to the DM'}
          </p>
          {character ? <p className="session-char">Beyond: {character.name}</p> : null}
          {roomId ? <code className="session-code">{roomId}</code> : null}
          {link ? (
            <button type="button" className="session-link" onClick={() => void copy()}>
              {copied ? 'Copied join link' : 'Copy join link'}
            </button>
          ) : null}
          {role === 'host' && links.length > 1 ? (
            <ul className="session-links">
              {links.map((item) => (
                <li key={item}>
                  <button type="button" className="session-link is-quiet" onClick={() => void copy(item)}>
                    {item.replace(/^https?:\/\//, '')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="session-btn is-quiet" onClick={() => useSessionStore.getState().leave()}>
            {role === 'host' ? 'End table' : 'Leave'}
          </button>
        </div>
      )}
      {error ? <p className="session-error">{error}</p> : null}
      {role === 'solo' ? (
        <p className="session-hint">
          Players must open the DM&apos;s join link on this network, not their own localhost. Restart Crawler&apos;s
          dev server after this update.
        </p>
      ) : role === 'host' ? (
        <p className="session-hint">Share the LAN link (not localhost) so other computers can reach this table.</p>
      ) : null}
    </section>
  )
}
