import { useState } from 'react'
import type { StatKey } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'

export type Editing = StatKey | 'initiativeRoll' | null

export function useStatEditing(player: Player) {
  const [editing, setEditing] = useState<Editing>(null)

  function commit(key: StatKey, value: string): void {
    useDungeonStore.getState().setPlayerStat(player.id, key, value === '' ? null : value)
    setEditing(null)
  }

  return { editing, setEditing, commit }
}
