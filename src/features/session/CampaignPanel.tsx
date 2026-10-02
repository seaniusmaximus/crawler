import { useState, type FormEvent } from 'react'
import { signInHref, type Campaign } from '../../net/api.ts'
import { useAccountStore } from '../../state/accountStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'

/** Sign in, start a campaign from the current map, or reopen a saved one. */
export function CampaignPanel() {
  const loaded = useAccountStore((state) => state.loaded)
  const available = useAccountStore((state) => state.signInAvailable)
  const user = useAccountStore((state) => state.user)
  const campaigns = useAccountStore((state) => state.campaigns)
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

      {campaigns.length ? (
        <ul className="campaign-list" aria-label="Your campaigns">
          {campaigns.map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} busy={busy} />
          ))}
        </ul>
      ) : null}
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}

function CampaignRow({ campaign, busy }: { campaign: Campaign; busy: boolean }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="campaign-row">
      <span className="campaign-copy">
        <span className="campaign-name">{campaign.name}</span>
        <span className="campaign-meta">Played {ago(campaign.playedAt)}</span>
      </span>
      {confirming ? (
        <>
          <button type="button" className="text-btn" onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button
            type="button"
            className="outline-btn is-danger is-small"
            disabled={busy}
            onClick={() => void useAccountStore.getState().deleteCampaign(campaign.id)}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="outline-btn is-small"
            onClick={() => useSessionStore.getState().hostCampaign(campaign, true)}
          >
            Resume
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete ${campaign.name}`}
            title="Delete campaign"
            onClick={() => setConfirming(true)}
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
