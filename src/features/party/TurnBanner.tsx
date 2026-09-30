import { characterNameOf } from '../../model/players.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { tokenShown } from './tokenInfo.ts'

/** Whose turn it is, top-centre, wherever the tool bar is not showing. */
export function TurnBanner() {
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const player = useDungeonStore((state) =>
    turnPlayerId ? (state.dungeon.players ?? []).find((item) => item.id === turnPlayerId) : undefined,
  )
  const viewMode = useEditorStore((state) => state.viewMode)
  const mine = useSessionStore((state) => state.myPlayerId != null && state.myPlayerId === turnPlayerId)

  if (!player || !tokenShown(player, floors, viewMode)) return null

  return (
    <div className={`panel turn-banner${mine ? ' is-mine' : ''}`} role="status">
      <Avatar player={player} size={30} turn />
      {mine ? (
        <>
          <span className="turn-banner-title">Your turn</span>
          <span className="turn-banner-sub">{characterNameOf(player)}</span>
        </>
      ) : (
        <span className="turn-banner-sub">
          <strong>{characterNameOf(player)}</strong>&apos;s turn
        </span>
      )}
    </div>
  )
}
