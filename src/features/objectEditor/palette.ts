/** Ready colours for the object editor: the materials the catalog's own objects are made of. */
export const PALETTE: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Oak', color: '#7a5232' },
  { name: 'Light oak', color: '#93653f' },
  { name: 'Dark oak', color: '#4f331d' },
  { name: 'Walnut', color: '#4a2c1a' },
  { name: 'Pine', color: '#8c6a40' },
  { name: 'Iron', color: '#3d3f46' },
  { name: 'Steel', color: '#b8bcc4' },
  { name: 'Brass', color: '#b08a3e' },
  { name: 'Gold', color: '#d1ae5c' },
  { name: 'Stone', color: '#8a8a90' },
  { name: 'Rock', color: '#6f6658' },
  { name: 'Marble', color: '#d9d4c7' },
  { name: 'Obsidian', color: '#1c1a20' },
  { name: 'Bone', color: '#ddd6c2' },
  { name: 'Linen', color: '#e8e1d0' },
  { name: 'Leather', color: '#6b5a3c' },
  { name: 'Crimson', color: '#7a2e2a' },
  { name: 'Wine', color: '#6d2635' },
  { name: 'Navy', color: '#2f4f6a' },
  { name: 'Royal', color: '#2f3f6e' },
  { name: 'Moss', color: '#5b6b34' },
  { name: 'Violet', color: '#7d5aa8' },
  { name: 'Ice', color: '#9fd0ea' },
  { name: 'Snow', color: '#f2f6fa' },
  { name: 'Ember', color: '#ff8a2a' },
  { name: 'Flame', color: '#ffd36a' },
  { name: 'Lava', color: '#ff6a1a' },
  { name: 'Glass', color: '#a9c4d4' },
]

/** A colour mixed toward white, for a top lit from above. */
export function lighter(hex: string, amount = 0.16): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  const r = mix((value >> 16) & 255)
  const g = mix((value >> 8) & 255)
  const b = mix(value & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
