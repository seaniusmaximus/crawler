import type { DiceRoll } from '../../model/dice.ts'
import { inlineImage } from '../../net/assets.ts'
import type { Dungeon } from '../../model/types.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'

/** A campaign backup the DM keeps themselves, independent of the server. */
interface SaveFile {
  app: 'crawler'
  version: 1
  savedAt: string
  name: string
  dungeon: Dungeon
  rolls: DiceRoll[]
}

/**
 * Download the map in this tab as a .crawler.json file. Portraits stored on the
 * server go back inline, so the file still works if the campaign is gone.
 */
export async function downloadSave(name: string): Promise<void> {
  const dungeon = useDungeonStore.getState().dungeon
  const players = await Promise.all(
    (dungeon.players ?? []).map(async (player) =>
      player.portrait ? { ...player, portrait: await inlineImage(player.portrait) } : player,
    ),
  )
  const file: SaveFile = {
    app: 'crawler',
    version: 1,
    savedAt: new Date().toISOString(),
    name,
    dungeon: { ...dungeon, players, travel: null },
    rolls: useDiceStore.getState().rolls,
  }
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slug(name) || 'crawler'}-${file.savedAt.slice(0, 10)}.crawler.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read a save file; throws a message fit to show the DM when it isn't one. */
export async function readSave(file: File): Promise<SaveFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error(`${file.name} isn't a Crawler save file.`)
  }
  const save = parsed as Partial<SaveFile> | null
  const dungeon = save?.dungeon as Partial<Dungeon> | undefined
  if (save?.app !== 'crawler' || !dungeon || !Array.isArray(dungeon.floors) || typeof dungeon.id !== 'string') {
    throw new Error(`${file.name} isn't a Crawler save file.`)
  }
  if (save.version !== 1) throw new Error(`${file.name} is from a newer version of Crawler.`)
  return {
    app: 'crawler',
    version: 1,
    savedAt: String(save.savedAt ?? ''),
    name: String(save.name ?? ''),
    dungeon: { ...(dungeon as Dungeon), players: Array.isArray(dungeon.players) ? dungeon.players : [] },
    rolls: Array.isArray(save.rolls) ? save.rolls : [],
  }
}

/** Put a save file's map in this tab, as an ordinary edit (so a hosted campaign saves it). */
export function applySave(save: SaveFile): void {
  useDungeonStore.getState().replaceDungeon(save.dungeon)
  useDiceStore.getState().replaceRolls(save.rolls)
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
