import sheet from './lava.png'
import { standardTileset } from './layout.ts'

// Painted by tools/tilesets/lava.mjs (`npm run tiles`).
export const LAVA = standardTileset('lava', 'Lava', sheet, { left: 0.6, right: 0.86 }, [
  'obsidian-altar',
  'anvil',
  'cage',
  'magma-rock',
  'brazier',
  'statue',
  'pillar',
  'weapon-rack',
  'chest',
  'bones',
])
