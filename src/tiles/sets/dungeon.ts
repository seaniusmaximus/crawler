import sheet from './dungeon.png'
import { standardTileset } from './layout.ts'

// Painted by tools/tilesets/dungeon.mjs (`npm run tiles`).
export const DUNGEON = standardTileset('dungeon', 'Dungeon', sheet, { left: 0.62, right: 0.88 })
