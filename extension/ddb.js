function runtimeAlive() {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

function sendRuntime(message) {
  if (!runtimeAlive()) return
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError
    })
  } catch {
    // Isolated world is gone; the sheet needs a refresh after an extension reload.
  }
}

function sendRolls(rolls) {
  const safe = cloneJson(rolls)
  if (!Array.isArray(safe) || !safe.length) return
  sendRuntime({ type: 'DICE_ROLL', rolls: safe })
}

const portraitCache = { url: '', data: null }

async function portraitData(url) {
  if (!url) return portraitCache.data
  if (url === portraitCache.url && portraitCache.data) return portraitCache.data
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const data = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : url)
      reader.onerror = () => resolve(url)
      reader.readAsDataURL(blob)
    })
    portraitCache.url = url
    portraitCache.data = data
    return data
  } catch {
    return url
  }
}

function fillMissing(base, extra) {
  if (!extra) return base || null
  const next = { ...(base || {}) }
  for (const [key, value] of Object.entries(extra)) {
    if (next[key] == null && value != null && value !== '') next[key] = value
  }
  return next
}

function pickCurrentHp(dom, api) {
  if (dom != null && dom > 0) return dom
  if (api != null && api > 0) return api
  if (dom === 0 && api === 0) return 0
  return dom ?? api ?? null
}

function pickMaxHp(dom, api) {
  if (dom != null && dom > 3) return dom
  if (api != null && api > 0) return api
  return dom ?? api ?? null
}

function mergeHp(dom, api) {
  return {
    hp: pickCurrentHp(dom?.hp, api?.hp),
    hpMax: pickMaxHp(dom?.hpMax, api?.hpMax),
    hpTemp: dom?.hpTemp ?? api?.hpTemp ?? null,
  }
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function looksLikeScore(value) {
  return value != null && value >= 8 && value <= 30
}

function reconcileAbilities(stats, api) {
  const next = { ...(stats || {}) }
  for (const key of ABILITY_KEYS) {
    const modKey = `${key}Mod`
    const apiScore = api?.[key]
    const apiMod = api?.[modKey]
    if (looksLikeScore(apiScore)) next[key] = apiScore
    else if (!looksLikeScore(next[key])) next[key] = null
    if (next[modKey] == null && apiMod != null) next[modKey] = apiMod
    if (next[modKey] == null && next[key] != null) next[modKey] = abilityMod(next[key])
    if (looksLikeScore(next[key]) && next[modKey] == null) next[modKey] = abilityMod(next[key])
  }
  return next
}

const ABILITY_BY_ID = { 1: 'str', 2: 'dex', 3: 'con', 4: 'int', 5: 'wis', 6: 'cha' }
const SCORE_SUBTYPE = {
  1: 'strength-score',
  2: 'dexterity-score',
  3: 'constitution-score',
  4: 'intelligence-score',
  5: 'wisdom-score',
  6: 'charisma-score',
}

function asNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function allModifiers(data) {
  const bags = data?.modifiers && typeof data.modifiers === 'object' ? data.modifiers : {}
  return Object.values(bags)
    .flat()
    .filter((item) => item && typeof item === 'object')
}

function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2)
}

function abilityScore(data, id) {
  const override = (data.overrideStats || []).find((item) => item?.id === id)
  if (override && override.value != null) return asNumber(override.value)
  const base = asNumber((data.stats || []).find((item) => item?.id === id)?.value) ?? 0
  const bonus = asNumber((data.bonusStats || []).find((item) => item?.id === id)?.value) ?? 0
  const mods = allModifiers(data).filter(
    (item) => item.subType === SCORE_SUBTYPE[id] && !item.restriction,
  )
  const set = mods.find((item) => item.type === 'set' && item.value != null)
  if (set) return asNumber(set.value)
  const extra = mods
    .filter((item) => item.type === 'bonus')
    .reduce((sum, item) => sum + (asNumber(item.value) || 0), 0)
  const total = base + bonus + extra
  return total > 0 ? total : null
}

function classLevel(data) {
  return (Array.isArray(data.classes) ? data.classes : []).reduce(
    (sum, item) => sum + (Number(item?.level) || 0),
    0,
  )
}

function proficiencyBonus(level) {
  return Math.max(2, Math.floor(((level || 1) - 1) / 4) + 2)
}

function modifierSum(data, type, subTypes) {
  const wanted = new Set(subTypes)
  return allModifiers(data)
    .filter((item) => item.type === type && wanted.has(item.subType) && !item.restriction)
    .reduce((sum, item) => sum + (asNumber(item.value) || 0), 0)
}

function hasModifier(data, type, subTypes) {
  const wanted = new Set(subTypes)
  return allModifiers(data).some((item) => item.type === type && wanted.has(item.subType))
}

function skillPassive(data, level, abilityId, skill) {
  const score = abilityScore(data, abilityId)
  if (score == null) return null
  const names = [skill, `skill-${skill}`]
  const proficient = hasModifier(data, 'proficiency', names)
  const expertise = hasModifier(data, 'expertise', names)
  const pb = proficiencyBonus(level)
  const bonus = modifierSum(data, 'bonus', names)
  const passiveBonus = modifierSum(data, 'bonus', [`passive-${skill}`, `${skill}-passive`])
  return 10 + abilityMod(score) + (expertise ? pb * 2 : proficient ? pb : 0) + bonus + passiveBonus
}

function maxHitPoints(data, level, conScore) {
  const override = asNumber(data.overrideHitPoints)
  if (override != null) return override
  const perLevel = modifierSum(data, 'bonus', ['hit-points-per-level'])
  const flat = modifierSum(data, 'bonus', ['hit-points', 'hp-max', 'maximum-hit-points'])
  return (
    (asNumber(data.baseHitPoints) || 0) +
    (asNumber(data.bonusHitPoints) || 0) +
    abilityMod(conScore ?? 10) * (level || 0) +
    perLevel * (level || 0) +
    flat
  )
}

function parseApiStats(data) {
  if (!data || typeof data !== 'object') return null
  const level = classLevel(data)
  const klass = (Array.isArray(data.classes) ? data.classes : [])
    .map((item) => item?.definition?.name)
    .filter(Boolean)
    .join(' / ')
  const abilities = {}
  const abilityMods = {}
  for (const [id, key] of Object.entries(ABILITY_BY_ID)) {
    const score = abilityScore(data, Number(id))
    abilities[key] = score
    if (score != null) abilityMods[`${key}Mod`] = abilityMod(score)
  }
  const hpMax = maxHitPoints(data, level, abilities.con)
  const removed = asNumber(data.removedHitPoints) || 0
  const hpTemp = asNumber(data.temporaryHitPoints)
  const initOverride = asNumber(data.overrideInitiative ?? data.initiativeBonus)
  const initiative =
    initOverride != null
      ? initOverride
      : abilities.dex != null
        ? abilityMod(abilities.dex) +
          modifierSum(data, 'bonus', ['initiative']) +
          (hasModifier(data, 'proficiency', ['initiative']) ? proficiencyBonus(level) : 0)
        : null
  return {
    hp: Number.isFinite(hpMax) ? Math.max(0, hpMax - removed) : null,
    hpMax: Number.isFinite(hpMax) && hpMax > 0 ? hpMax : null,
    hpTemp: hpTemp != null && hpTemp > 0 ? hpTemp : null,
    ac: asNumber(data.overrideAc ?? data.customAc),
    speed: asNumber(data.baseWalkSpeed ?? data.walkSpeed),
    initiative,
    level: level || null,
    klass: klass || null,
    ...abilities,
    ...abilityMods,
    passivePerception: skillPassive(data, level, 5, 'perception'),
    passiveInsight: skillPassive(data, level, 5, 'insight'),
    passiveInvestigation: skillPassive(data, level, 4, 'investigation'),
  }
}

async function fetchApiStats(characterId) {
  const urls = [
    `https://character-service.dndbeyond.com/character/v5/character/${characterId}`,
    `https://character-service.dndbeyond.com/character/v3/character/${characterId}`,
  ]
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: 'include' })
      if (!response.ok) continue
      const json = await response.json()
      const stats = parseApiStats(json.data || json)
      if (stats) return stats
    } catch {
      // Try the next character-service version.
    }
  }
  return null
}

let lastDomCharacter = null
let lastSentKey = ''
let pollBusy = false

async function sendCharacter(character) {
  if (!character || !character.characterId) return
  lastDomCharacter = character
  const [portrait, apiStats] = await Promise.all([
    portraitData(character.portrait),
    fetchApiStats(character.characterId),
  ])
  const filled = fillMissing(character.stats, apiStats)
  const merged = reconcileAbilities(filled, apiStats)
  Object.assign(merged, mergeHp(character.stats, apiStats))
  const payload = {
    characterId: String(character.characterId),
    name: String(character.name || ''),
    portrait,
    stats: merged,
  }
  const key = JSON.stringify({
    characterId: payload.characterId,
    name: payload.name,
    stats: payload.stats,
  })
  if (key === lastSentKey) return
  lastSentKey = key
  sendRuntime({ type: 'CHARACTER', character: payload })
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return
  if (event.data.type === 'CRAWLER_DDB_ROLL') {
    const rolls = Array.isArray(event.data.rolls) ? event.data.rolls : []
    if (rolls.length) sendRolls(rolls)
    return
  }
  if (event.data.type === 'CRAWLER_DDB_CHARACTER') {
    void sendCharacter(event.data.character)
  }
})

window.setInterval(() => {
  if (pollBusy || !lastDomCharacter) return
  pollBusy = true
  void sendCharacter(lastDomCharacter).finally(() => {
    pollBusy = false
  })
}, 2000)
