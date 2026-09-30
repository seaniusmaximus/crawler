export const STAT_KEYS = [
  'hp',
  'hpMax',
  'hpTemp',
  'ac',
  'speed',
  'initiative',
  'level',
  'klass',
  'race',
  'str',
  'dex',
  'con',
  'int',
  'wis',
  'cha',
  'strMod',
  'dexMod',
  'conMod',
  'intMod',
  'wisMod',
  'chaMod',
  'passivePerception',
  'passiveInsight',
  'passiveInvestigation',
] as const

export type StatKey = (typeof STAT_KEYS)[number]
/** Stats held as free text rather than numbers. */
export type TextStatKey = 'klass' | 'race'
export function isTextStat(key: StatKey): key is TextStatKey {
  return key === 'klass' || key === 'race'
}
export type StatsManual = Partial<Record<StatKey, boolean>>

export type CharacterStats = {
  hp: number | null
  hpMax: number | null
  hpTemp: number | null
  ac: number | null
  speed: number | null
  initiative: number | null
  level: number | null
  klass: string
  race: string
  str: number | null
  dex: number | null
  con: number | null
  int: number | null
  wis: number | null
  cha: number | null
  strMod: number | null
  dexMod: number | null
  conMod: number | null
  intMod: number | null
  wisMod: number | null
  chaMod: number | null
  passivePerception: number | null
  passiveInsight: number | null
  passiveInvestigation: number | null
}

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type AbilityKey = (typeof ABILITY_KEYS)[number]
export type AbilityModKey = `${AbilityKey}Mod`

export const ABILITY_MOD_KEY: Record<AbilityKey, AbilityModKey> = {
  str: 'strMod',
  dex: 'dexMod',
  con: 'conMod',
  int: 'intMod',
  wis: 'wisMod',
  cha: 'chaMod',
}

export const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
}

export const PASSIVE_KEYS = ['passivePerception', 'passiveInsight', 'passiveInvestigation'] as const
export type PassiveKey = (typeof PASSIVE_KEYS)[number]

export const PASSIVE_LABEL: Record<PassiveKey, string> = {
  passivePerception: 'P.Per',
  passiveInsight: 'P.Ins',
  passiveInvestigation: 'P.Inv',
}

export function emptyStats(): CharacterStats {
  return {
    hp: null,
    hpMax: null,
    hpTemp: null,
    ac: null,
    speed: null,
    initiative: null,
    level: null,
    klass: '',
    race: '',
    str: null,
    dex: null,
    con: null,
    int: null,
    wis: null,
    cha: null,
    strMod: null,
    dexMod: null,
    conMod: null,
    intMod: null,
    wisMod: null,
    chaMod: null,
    passivePerception: null,
    passiveInsight: null,
    passiveInvestigation: null,
  }
}

export function abilityMod(score: number | null): number | null {
  if (score == null || !Number.isFinite(score)) return null
  return Math.floor((score - 10) / 2)
}

export function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

export function formatAbility(score: number): string {
  const mod = abilityMod(score)
  return mod == null ? `${score}` : `${score} (${formatSigned(mod)})`
}

export function scoreFromModifier(mod: number, current: number | null): number {
  if (current != null && isAbilityScore(current) && abilityMod(current) === mod) return current
  return 10 + 2 * mod
}

export function isAbilityScore(value: number | null): boolean {
  return value != null && value >= 8 && value <= 30
}

export function isAbilityMod(value: number | null): boolean {
  return value != null && value >= -5 && value <= 12
}

export function displayedAbilityMod(stats: CharacterStats, key: AbilityKey): number | null {
  const stored = stats[ABILITY_MOD_KEY[key]]
  if (stored != null) return stored
  return abilityMod(stats[key])
}

export function repairAbility(score: number | null, mod: number | null): {
  score: number | null
  mod: number | null
} {
  if (isAbilityScore(score)) {
    return { score, mod: mod ?? abilityMod(score) }
  }
  if (score != null && score >= -5 && score <= 5 && !isAbilityScore(mod)) {
    return { score: null, mod: score }
  }
  if (mod != null && isAbilityScore(mod) && !isAbilityScore(score)) {
    return { score: mod, mod: abilityMod(mod) }
  }
  return { score, mod: mod ?? (score != null ? abilityMod(score) : null) }
}

export function hpRatio(hp: number | null, hpMax: number | null): number | null {
  if (hp == null || hpMax == null || hpMax <= 0) return null
  return Math.min(1, Math.max(0, hp / hpMax))
}

export function hpBarColor(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio))
  const hue = t <= 0.5 ? t * 2 * 50 : 50 + (t - 0.5) * 2 * 70
  return `hsl(${Math.round(hue)} 72% 46%)`
}

function abilityFields(raw: Record<string, unknown>): Pick<
  CharacterStats,
  AbilityKey | AbilityModKey
> {
  const out = {} as Pick<CharacterStats, AbilityKey | AbilityModKey>
  for (const key of ABILITY_KEYS) {
    const repaired = repairAbility(asNumber(raw[key]), asNumber(raw[ABILITY_MOD_KEY[key]]))
    out[key] = repaired.score
    out[ABILITY_MOD_KEY[key]] = repaired.mod
  }
  return out
}

function mergeAbility(
  next: CharacterStats,
  incoming: Partial<CharacterStats>,
  manual: StatsManual,
  key: AbilityKey,
): void {
  const modKey = ABILITY_MOD_KEY[key]
  const incomingScore = incoming[key] ?? null
  const incomingMod = incoming[modKey] ?? null
  const repaired = repairAbility(incomingScore, incomingMod)
  if (!manual[key] && repaired.score != null) {
    if (isAbilityScore(repaired.score) || !isAbilityScore(next[key])) next[key] = repaired.score
  }
  if (!manual[modKey] && repaired.mod != null) next[modKey] = repaired.mod
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeStats(value: unknown): CharacterStats {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    hp: asNumber(raw.hp),
    hpMax: asNumber(raw.hpMax),
    hpTemp: asNumber(raw.hpTemp),
    ac: asNumber(raw.ac),
    speed: asNumber(raw.speed),
    initiative: asNumber(raw.initiative),
    level: asNumber(raw.level),
    klass: typeof raw.klass === 'string' ? raw.klass : '',
    race: typeof raw.race === 'string' ? raw.race : '',
    ...abilityFields(raw),
    passivePerception: asNumber(raw.passivePerception),
    passiveInsight: asNumber(raw.passiveInsight),
    passiveInvestigation: asNumber(raw.passiveInvestigation),
  }
}

export function mergeDdbStats(
  current: CharacterStats,
  incoming: Partial<CharacterStats> | null | undefined,
  manual: StatsManual = {},
): CharacterStats {
  if (!incoming) return current
  const next = { ...current }
  if (!manual.hp && incoming.hp != null) next.hp = incoming.hp
  if (!manual.hpMax && incoming.hpMax != null) next.hpMax = incoming.hpMax
  if (!manual.hpTemp && incoming.hpTemp != null) next.hpTemp = incoming.hpTemp
  if (!manual.ac && incoming.ac != null) next.ac = incoming.ac
  if (!manual.speed && incoming.speed != null) next.speed = incoming.speed
  if (!manual.initiative && incoming.initiative != null) next.initiative = incoming.initiative
  if (!manual.level && incoming.level != null) next.level = incoming.level
  if (!manual.klass && incoming.klass) next.klass = incoming.klass
  if (!manual.race && incoming.race) next.race = incoming.race
  mergeAbility(next, incoming, manual, 'str')
  mergeAbility(next, incoming, manual, 'dex')
  mergeAbility(next, incoming, manual, 'con')
  mergeAbility(next, incoming, manual, 'int')
  mergeAbility(next, incoming, manual, 'wis')
  mergeAbility(next, incoming, manual, 'cha')
  if (!manual.passivePerception && incoming.passivePerception != null) {
    next.passivePerception = incoming.passivePerception
  }
  if (!manual.passiveInsight && incoming.passiveInsight != null) {
    next.passiveInsight = incoming.passiveInsight
  }
  if (!manual.passiveInvestigation && incoming.passiveInvestigation != null) {
    next.passiveInvestigation = incoming.passiveInvestigation
  }
  return next
}
