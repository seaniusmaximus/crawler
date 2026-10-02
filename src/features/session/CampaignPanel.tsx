import { useEffect, useState, type FormEvent } from 'react'
import { signInHref, type Campaign } from '../../net/api.ts'
import { useAccountStore } from '../../state/accountStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'

/** Sign in, start a campaign from the current map, or reopen a saved one. */
export function CampaignPanel() {
  const loaded = useAccountStore((state) => state.loaded)
  const available = useAccountStore((state) => state.signInAvailable)
  const user = useAccountStore((state) => state.user)
  const busy = useAccountStore((state) => state.busy)
  const error = useAccountStore((state) => state.error)
  const [name, setName] = useState('')

  if (!loaded) return <p className="panel-note">Checking sign-in…</p>
  if (!available) {
    return <p className="panel-note">Google sign-in isn&apos;t set up on this server, so tables can&apos;t be hosted.</p>
  }
  if (!user) {
    return (
      <>
        <a className="roll-btn is-small campaign-signin" href={signInHref()}>
          Sign in with Google to host
        </a>
        <p className="panel-note">Your campaigns are saved to your Google account. Players don&apos;t need to sign in.</p>
      </>
    )
  }

  async function start(event: FormEvent): Promise<void> {
    event.preventDefault()
    const campaign = await useAccountStore.getState().createCampaign(name)
    if (!campaign) return
    setName('')
    useSessionStore.getState().hostCampaign(campaign, false)
  }

  return (
    <>
      <div className="campaign-user">
        {user.picture ? <img className="campaign-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" /> : null}
        <span className="campaign-user-name">{user.name}</span>
        <button type="button" className="text-btn" onClick={() => void useAccountStore.getState().signOut()}>
          Sign out
        </button>
      </div>

      <form className="table-join" onSubmit={(event) => void start(event)}>
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="New campaign name"
          aria-label="New campaign name"
          maxLength={80}
        />
        <button type="submit" className="outline-btn" disabled={busy}>
          Host
        </button>
      </form>
      <p className="panel-note">A new campaign starts from the map you have open.</p>

      <CampaignList />
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}

/** The signed-in DM's saved campaigns, newest played first. */
export function CampaignList({ empty }: { empty?: string }) {
  const user = useAccountStore((state) => state.user)
  const campaigns = useAccountStore((state) => state.campaigns)

  // "Played" times move whenever a campaign is hosted; pick that up on open.
  useEffect(() => {
    if (useAccountStore.getState().user) void useAccountStore.getState().refreshCampaigns()
  }, [])

  if (!user) return null
  if (!campaigns.length) return empty ? <p className="panel-note">{empty}</p> : null
  return (
    <ul className="campaign-list" aria-label="Your campaigns">
      {campaigns.map((campaign) => (
        <CampaignRow key={campaign.id} campaign={campaign} />
      ))}
    </ul>
  )
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const busy = useAccountStore((state) => state.busy)
  const role = useSessionStore((state) => state.role)
  const roomId = useSessionStore((state) => state.roomId)
  const saveState = useSessionStore((state) => state.saveState)
  const [confirming, setConfirming] = useState<'delete' | 'replace' | null>(null)

  const current = role === 'host' && roomId === campaign.id
  // Switching campaigns mid-save could drop the last change to the open one.
  const waitForSave = role === 'host' && !current && saveState !== 'saved'

  function resume(): void {
    if (role === 'solo' && saveState === 'unsaved' && confirming !== 'replace') {
      setConfirming('replace')
      return
    }
    setConfirming(null)
    useSessionStore.getState().hostCampaign(campaign, true)
  }

  return (
    <li className={`campaign-row${current ? ' is-current' : ''}`}>
      <span className="campaign-copy">
        <span className="campaign-name">{campaign.name}</span>
        <span className="campaign-meta">
          {confirming === 'replace'
            ? "Replace the unsaved map you're working on?"
            : confirming === 'delete'
              ? current
                ? 'Delete it and end this table?'
                : 'Delete it and all its save points?'
              : current
                ? 'Open now'
                : `Played ${ago(campaign.playedAt)}`}
        </span>
      </span>
      {confirming ? (
        <>
          <button type="button" className="text-btn" onClick={() => setConfirming(null)}>
            Cancel
          </button>
          {confirming === 'delete' ? (
            <button
              type="button"
              className="outline-btn is-danger is-small"
              disabled={busy}
              onClick={() => void useAccountStore.getState().deleteCampaign(campaign.id)}
            >
              Delete
            </button>
          ) : (
            <button type="button" className="outline-btn is-danger is-small" onClick={resume}>
              Replace
            </button>
          )}
        </>
      ) : (
        <>
          {current ? (
            <span className="campaign-tag">Open</span>
          ) : (
            <button
              type="button"
              className="outline-btn is-small"
              disabled={waitForSave}
              title={waitForSave ? 'Wait until the open campaign says Saved' : undefined}
              onClick={resume}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete ${campaign.name}`}
            title="Delete campaign"
            onClick={() => setConfirming('delete')}
          >
            <Icon id="close" size={14} />
          </button>
        </>
      )}
    </li>
  )
}
function ago(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(time).toLocaleDateString()
}
