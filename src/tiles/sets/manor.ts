import sheet from './manor.png'
import { standardTileset } from './layout.ts'

// Painted by tools/tilesets/manor.mjs (`npm run tiles`).
export const MANOR = standardTileset('manor', 'Manor House', sheet, { left: 0.66, right: 0.9 }, [
  'dining-table',
  'chair',
  'armchair',
  'writing-desk',
  'bookshelf',
  'wardrobe',
  'canopy-bed',
  'ornate-rug',
  'rug',
  'mirror',
  'bust',
  'candelabra',
  'chest',
  'statue',
])
