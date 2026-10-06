import sheet from './ice.png'
import { standardTileset } from './layout.ts'

// Painted by tools/tilesets/ice.mjs (`npm run tiles`).
export const ICE = standardTileset('ice', 'Snow & Ice', sheet, { left: 0.7, right: 0.92 }, [
  'ice-block',
  'ice-crystal',
  'frozen-statue',
  'snow-drift',
  'fur-rug',
  'chest',
  'barrel',
  'crate',
  'brazier',
  'bedroll',
])
