import { useEffect, useState } from 'react'
import { characterNameOf } from '../../model/players.ts'
import type { SessionPeer } from '../../net/protocol.ts'
import { useAccountStore } from '../../state/accountStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { bootSessionFromUrl, useSessionStore } from '../../state/sessionStore.ts'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { CampaignPanel } from './CampaignPanel.tsx'

/** Wordmark and a one-line read of the table's connection, top-left. */
export function Brand() {
  const role = useSessionStore((state) => state.role)
  const status = useSessionStore((state) => state.status)
  const roomId = useSessionStore((state) => state.roomId)
  const peers = useSessionStore((state) => state.peers)
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const me = useDungeonStore((state) =>
    myPlayerId ? (state.dungeon.players ?? []).find((player) => player.id === myPlayerId) : undefined,
  )
  const character = useSessionStore((state) => state.character)
  const hostOnline = useSessionStore((state) => state.hostOnline)
  const campaignName = useSessionStore((state) => state.campaignName)

  useEffect(() => {
    bootSessionFromUrl()
    void useAccountStore.getState().load()
  }, [])

  let line: string
  if (status === 'connecting') line = role === 'host' ? 'Opening the table…' : 'Joining the table…'
  else if (status === 'reconnecting') line = 'Reconnecting…'
  else if (status === 'error') line = 'Connection lost'
  else if (role === 'guest' && !hostOnline) line = 'Waiting for the DM…'
  else if (role === 'host') line = `${campaignName || `Table ${roomId ?? ''}`} · ${playerCount(peers)} ${playerCount(peers) === 1 ? 'player' : 'players'} joined`
  else if (role === 'guest') {
    const name = me ? characterNameOf(me) : character?.name
    line = name ? `Playing as ${name}${me?.name && me.name !== name ? ` · ${me.name}` : ''}` : 'Connected to the DM'
  } else line = 'Solo table · not hosting'

  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden>
        <Icon id="d20" size={22} strokeWidth={1.3} />
      </span>
      <div className="brand-copy">
        <span className="brand-name">Crawler</span>
        <span className="brand-status">
          <span className={`status-pip${status === 'live' ? ' is-on' : ''}${status === 'error' ? ' is-err' : ''}`} />
          <span>{line}</span>
        </span>
      </div>
    </div>
  )
}

/** Host, join, invite and leave — opened from the button beside the view toggle. */
export function TableMenu() {
  const role = useSessionStore((state) => state.role)
  const status = useSessionStore((state) => state.status)
  const link = useSessionStore((state) => state.link)
  const links = useSessionStore((state) => state.links)
  const roomId = useSessionStore((state) => state.roomId)
  const peers = useSessionStore((state) => state.peers)
  const error = useSessionStore((state) => state.error)
  const character = useSessionStore((state) => state.character)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')

  // Show why hosting stopped (signed out, campaign deleted) without making the DM go looking.
  useEffect(
    () =>
      useSessionStore.subscribe((state, prev) => {
        if (state.error && state.error !== prev.error) setOpen(true)
      }),
    [],
  )

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

  const label = role === 'host' ? 'Invite' : role === 'guest' ? 'Table' : 'Host'

  return (
    <div className="table-menu">
      <button
        type="button"
        className={`panel pill-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon id={role === 'host' ? 'share' : 'person'} className="is-gold" />
        {label}
      </button>

      {open ? (
        <section className="panel table-pop" aria-label="Table">
          <header className="panel-head">
            <h2 className="panel-title">
              <Diamond />
              <span>Table</span>
            </h2>
            <button type="button" className="icon-btn is-boxed" aria-label="Close" onClick={() => setOpen(false)}>
              <Icon id="close" size={15} />
            </button>
          </header>

          {role === 'solo' ? (
            <div className="table-actions">
              <CampaignPanel />
              <span className="kicker">Join a table</span>
              <form
                className="table-join"
                onSubmit={(event) => {
                  event.preventDefault()
                  useSessionStore.getState().join(code)
                }}
              >
                <input
                  className="field"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="Paste a join link"
                  aria-label="Join link"
                />
                <button type="submit" className="outline-btn">
                  Join
                </button>
              </form>
              <p className="panel-note">
                Players must open the DM&apos;s join link on this network, not their own localhost.
              </p>
            </div>
          ) : (
            <div className="table-actions">
              <p className="panel-note">
                {status === 'connecting'
                  ? 'Connecting…'
                  : status === 'reconnecting'
                    ? 'Reconnecting…'
                    : status === 'error'
                      ? 'Disconnected'
                      : role === 'host'
                        ? `Hosting · ${playerCount(peers)} connected`
                        : 'Connected to the DM'}
              </p>
              {character ? <p className="panel-note">D&amp;D Beyond: {character.name}</p> : null}
              {role === 'guest' ? (
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => {
                    setOpen(false)
                    useSessionStore.getState().setSeatPrompt(true)
                  }}
                >
                  <Icon id="person" size={15} />
                  Choose character
                </button>
              ) : null}
              {roomId ? <code className="field is-code">{roomId}</code> : null}
              {link ? (
                <button type="button" className="outline-btn" onClick={() => void copy()}>
                  <Icon id="link" size={15} />
                  {copied ? 'Copied join link' : 'Copy join link'}
                </button>
              ) : null}
              {role === 'host' && links.length > 1 ? (
                <ul className="table-links">
                  {links.map((item) => (
                    <li key={item}>
                      <button type="button" className="text-btn" onClick={() => void copy(item)}>
                        {item.replace(/^https?:\/\//, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {role === 'host' ? (
                <p className="panel-note">Share the LAN link (not localhost) so other computers can reach this table.</p>
              ) : null}
              {role === 'host' ? (
                <>
                  <button
                    type="button"
                    className="outline-btn"
                    onClick={() => {
                      useSessionStore.getState().closeTable()
                      void useAccountStore.getState().refreshCampaigns()
                    }}
                  >
                    Close table
                  </button>
                  <p className="panel-note">Closing saves the campaign; resume it any time from this menu.</p>
                </>
              ) : (
                <button type="button" className="outline-btn is-danger" onClick={() => useSessionStore.getState().leave()}>
                  Leave
                </button>
              )}
            </div>
          )}
          {error ? <p className="panel-note is-error">{error}</p> : null}
        </section>
      ) : null}
    </div>
  )
}

/** People at the table: several tabs on one token count once. */
function playerCount(peers: readonly SessionPeer[]): number {
  return new Set(peers.map((peer) => peer.playerId ?? peer.id)).size
}
