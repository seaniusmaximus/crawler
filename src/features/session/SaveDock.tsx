import { useState, type FormEvent, type ReactNode } from 'react'
import { signInHref } from '../../net/api.ts'
import { useAccountStore } from '../../state/accountStore.ts'
import { useSessionStore, type SaveState } from '../../state/sessionStore.ts'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { CampaignList } from './CampaignPanel.tsx'
import { SaveFileActions } from './SaveFileActions.tsx'
import { SavePoints } from './SavePoints.tsx'

const BUBBLE_LABEL: Record<SaveState, string> = {
  idle: 'Not saved',
  unsaved: 'Not saved',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline',
}

/** Everything about keeping the map: status, campaign saving, save points and backups. */
export function SaveDock() {
  const role = useSessionStore((state) => state.role)
  const saveState = useSessionStore((state) => state.saveState)
  const campaignName = useSessionStore((state) => state.campaignName)
  const [open, setOpen] = useState(false)

  if (role === 'guest') return null
  const hosting = role === 'host'
  const tone = saveState === 'saved' ? 'good' : saveState === 'saving' ? 'busy' : 'warn'

  return (
    <div className="save-dock">
      {open ? <SavePanel onClose={() => setOpen(false)} /> : null}
      <button
        type="button"
        className={`panel save-fab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={`Save: ${BUBBLE_LABEL[saveState]}`}
        onClick={() => setOpen(!open)}
      >
        <Icon id="save" size={22} className="is-gold" />
        <span className="save-fab-copy">
          <span className={`save-fab-state is-${tone}`}>{BUBBLE_LABEL[saveState]}</span>
          <span className="save-fab-name">{hosting ? campaignName || 'Campaign' : 'No campaign'}</span>
        </span>
      </button>
    </div>
  )
}

function SavePanel({ onClose }: { onClose: () => void }) {
  const role = useSessionStore((state) => state.role)
  const roomId = useSessionStore((state) => state.roomId)
  const signedIn = useAccountStore((state) => state.user !== null)

  return (
    <section className="panel save-panel" aria-label="Save">
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Save</span>
        </h2>
        <button type="button" className="icon-btn is-boxed" aria-label="Close" onClick={onClose}>
          <Icon id="close" size={15} />
        </button>
      </header>

      <SaveStatus />

      {role === 'host' && roomId ? (
        <>
          <span className="kicker">Save points</span>
          <SavePoints campaignId={roomId} />
        </>
      ) : null}

      {signedIn ? (
        <>
          <span className="kicker">Your campaigns</span>
          <CampaignList empty="No saved campaigns yet." />
        </>
      ) : null}

      <SaveFileActions />
    </section>
  )
}

/** What's saved right now, and the one thing to do about it if it isn't. */
function SaveStatus() {
  const role = useSessionStore((state) => state.role)
  const saveState = useSessionStore((state) => state.saveState)
  const savedAt = useSessionStore((state) => state.savedAt)
  const campaignName = useSessionStore((state) => state.campaignName) || 'This campaign'

  if (role === 'host') {
    if (saveState === 'offline') {
      return (
        <Status title="Offline" tone="warn">
          Changes will save when the connection comes back. Keep this tab open until it says Saved.
        </Status>
      )
    }
    if (saveState === 'saved') {
      return (
        <Status title={`“${campaignName}” is saved`} tone="good">
          Changes save automatically{savedAt ? `; last saved at ${new Date(savedAt).toLocaleTimeString()}` : ''}.
        </Status>
      )
    }
    return (
      <Status title={`Saving “${campaignName}”…`} tone="busy">
        Changes save automatically while the campaign is open.
      </Status>
    )
  }

  return (
    <Status title={saveState === 'unsaved' ? "This map isn't saved" : 'Nothing saved yet'} tone="warn">
      <SaveAsCampaign />
    </Status>
  )
}

function Status({ title, tone, children }: { title: string; tone: 'good' | 'busy' | 'warn'; children: ReactNode }) {
  return (
    <div className={`save-status is-${tone}`}>
      <p className="save-status-title">
        <span className={`status-pip${tone === 'good' ? ' is-on' : ''}`} />
        {title}
      </p>
      <div className="save-status-body">{children}</div>
    </div>
  )
}

/** A solo map becomes a campaign, which saves from then on. */
function SaveAsCampaign() {
  const loaded = useAccountStore((state) => state.loaded)
  const available = useAccountStore((state) => state.signInAvailable)
  const user = useAccountStore((state) => state.user)
  const busy = useAccountStore((state) => state.busy)
  const error = useAccountStore((state) => state.error)
  const [name, setName] = useState('')

  if (!loaded) return <p className="panel-note">Checking sign-in…</p>
  if (!available) {
    return <p className="panel-note">Saving to the cloud isn&apos;t set up here. Download a save file to keep this map.</p>
  }
  if (!user) {
    return (
      <>
        <p className="panel-note">Sign in to save this map as a campaign you can come back to from any device.</p>
        <a className="roll-btn is-small campaign-signin" href={signInHref()}>
          Sign in with Google to save
        </a>
      </>
    )
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const campaign = await useAccountStore.getState().createCampaign(name)
    if (!campaign) return
    setName('')
    useSessionStore.getState().hostCampaign(campaign, false)
  }

  return (
    <>
      <p className="panel-note">Save it as a campaign and it keeps saving as you go. Players can join it too.</p>
      <form className="table-join" onSubmit={(event) => void save(event)}>
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Campaign name"
          aria-label="Campaign name"
          maxLength={80}
        />
        <button type="submit" className="outline-btn" disabled={busy}>
          Save
        </button>
      </form>
      <p className="panel-note">Or pick up a saved campaign from Your campaigns below.</p>
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}
