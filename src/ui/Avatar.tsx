import type { CSSProperties } from 'react'
import { characterNameOf, playerInitials } from '../model/players.ts'
import type { Player } from '../model/types.ts'

/** A token's ring: its colour, its portrait or initials, and a gold halo on its turn. */
export function Avatar({
  player,
  size = 38,
  turn = false,
  dim = false,
}: {
  player: Player
  size?: number
  turn?: boolean
  dim?: boolean
}) {
  const name = characterNameOf(player)
  return (
    <span
      className={`avatar${turn ? ' is-turn' : ''}${dim ? ' is-dim' : ''}`}
      title={name}
      style={
        {
          '--avatar-color': player.color,
          '--avatar-size': `${size}px`,
        } as CSSProperties
      }
    >
      {player.portrait ? <img src={player.portrait} alt="" /> : playerInitials(name)}
    </span>
  )
}
