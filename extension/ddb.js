// Reads the D&D Beyond sheet the user has open and forwards it to Crawler.
//
// Page-only by design: this runs in the extension's isolated world, reads what
// the sheet already shows, and never injects code into the page, patches its
// network calls, hooks its internals, or calls D&D Beyond's services itself.

const CHARACTER_POLL_MS = 2000
const ROLL_SCAN_MS = 1500

function runtimeAlive() {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
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

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clean(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function textOf(root, selector) {
  return clean(root.querySelector(selector)?.textContent)
}

function firstText(selectors) {
  for (const selector of selectors) {
    const text = clean(document.querySelector(selector)?.textContent)
    if (text) return text
  }
  return ''
}

function firstNumber(selectors) {
  return num(firstText(selectors).replace(/,/g, '').match(/-?\d+/)?.[0])
}

function signedNumber(selectors) {
  const match = firstText(selectors)
    .replace(/,/g, '')
    .match(/([+-]?)(\d+)/)
  if (!match) return null
  const value = Number(match[2])
  return match[1] === '-' ? -value : value
}

// ---------- Who is on this sheet ----------

function sheetCharacterId() {
  return (window.location.pathname.match(/\/characters\/(\d+)/) || [])[1] || ''
}

function characterName() {
  const fromDom = firstText([
    '.ddbc-character-tidbits__heading h1',
    '.ct-character-tidbits__heading h1',
    '[class*="character-tidbits"] h1',
  ])
  if (fromDom) return fromDom
  return document.title.replace(/\s*[-–|].*$/, '').trim() || 'D&D Beyond'
}

function portraitUrl() {
  const img =
    document.querySelector('.ddbc-character-avatar__portrait') ||
    document.querySelector('.ct-character-tidbits__avatar img') ||
    document.querySelector('[class*="character-avatar"] img') ||
    document.querySelector('[class*="character-tidbits"] img')
  return (img instanceof HTMLImageElement && img.src) || ''
}

// The portrait is the image the sheet is already showing; re-reading it is
// normally served from the browser cache and happens once per image.
const portraitCache = { url: '', data: null }

async function portraitData(url) {
  if (!url) return null
  if (url === portraitCache.url) return portraitCache.data
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
    portraitCache.url = url
    portraitCache.data = url
    return url
  }
}

// ---------- Stats shown on the sheet ----------

function itemValue(item) {
  const input = item.querySelector('input')
  if (input && input.value !== '') return num(input.value)
  const button = item.querySelector('button[class*="value"], button[class*="Value"]')
  if (button) return num((button.textContent || '').replace(/,/g, '').match(/-?\d+/)?.[0])
  return num((item.textContent || '').replace(/,/g, '').match(/-?\d+/)?.[0])
}

function looksLikeHpPair(current, max) {
  if (current == null || max == null) return false
  if (max <= 3) return false
  return max >= current || current === 0
}

function scrapeHp() {
  let hp = null
  let hpMax = null
  let hpTemp = null

  const items = document.querySelectorAll(
    '.ct-health-summary__hp-item, [class*="health-summary__hp-item"], .ct-quick-info__health [class*="styles_item"], [class*="styles_innerContainer"] [class*="styles_item"]',
  )
  for (const item of items) {
    const text = clean(item.textContent)
    const value = itemValue(item)
    if (value == null) continue
    if (/current/i.test(text)) hp = value
    else if (/\bmax\b/i.test(text)) hpMax = value
    else if (/temp/i.test(text)) hpTemp = value
  }

  if (hp == null) {
    hp = firstNumber([
      '.ct-health-summary__hp-number--current',
      '.ct-status-summary-mobile__hp-current',
      '[class*="health-summary__hp-number--current"]',
      '[class*="hp-current"]',
    ])
  }
  if (hpMax == null) {
    hpMax = firstNumber([
      '.ct-health-summary__hp-number--max',
      '.ct-status-summary-mobile__hp-max',
      '[class*="health-summary__hp-number--max"]',
      '[class*="hp-max"]',
      '[class*="styles_maxContainer"]',
    ])
  }
  if (hpTemp == null) {
    hpTemp = firstNumber([
      '.ct-health-summary__hp-number--temp',
      '[class*="health-summary__hp-number--temp"]',
      '[class*="styles_temp"] input',
      '[class*="styles_temp"] button',
    ])
  }

  if (hp == null || hpMax == null) {
    const slashNodes = document.querySelectorAll(
      '.ct-health-summary__hp-group--primary, .ct-health-summary__hp, .ct-status-summary-mobile__hp, [class*="hp-group--primary"]',
    )
    for (const node of slashNodes) {
      const match = clean(node.textContent).match(/(-?\d+)\s*\/\s*(-?\d+)/)
      if (!match) continue
      const current = num(match[1])
      const max = num(match[2])
      if (!looksLikeHpPair(current, max)) continue
      if (hp == null) hp = current
      if (hpMax == null) hpMax = max
      break
    }
  }

  return { hp, hpMax, hpTemp: hpTemp != null && hpTemp > 0 ? hpTemp : null }
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function signedFrom(text) {
  const match = String(text || '')
    .replace(/,/g, '')
    .match(/([+-])\s*(\d+)/)
  if (!match) return null
  const value = Number(match[2])
  return match[1] === '-' ? -value : value
}

function unsignedFrom(text) {
  const cleaned = String(text || '').replace(/,/g, '')
  if (/[+-]/.test(cleaned)) return null
  return num(cleaned.match(/\d+/)?.[0])
}

function scrapeAbilities() {
  const nodes = document.querySelectorAll(
    '.ct-quick-info__ability, .ddbc-quick-info__ability, .ct-ability-summary, .ddbc-ability-summary, [class*="ability-summary"]',
  )
  const out = {}
  for (const node of nodes) {
    const key = textOf(
      node,
      '.ct-ability-summary__abbr, .ddbc-ability-summary__abbr, [class*="ability-summary__abbr"]',
    ).toLowerCase()
    if (!ABILITY_KEYS.includes(key) || out[key] != null) continue
    const primary = textOf(
      node,
      '.ct-ability-summary__primary, .ddbc-ability-summary__primary, [class*="ability-summary__primary"]',
    )
    const secondary = textOf(
      node,
      '.ct-ability-summary__secondary, .ddbc-ability-summary__secondary, [class*="ability-summary__secondary"]',
    )
    // The sheet can be set to show either the modifier or the score on top.
    let mod = signedFrom(primary)
    let score = unsignedFrom(secondary)
    if (mod == null) {
      mod = signedFrom(secondary)
      score = unsignedFrom(primary)
    }
    if (score != null && score < 1) score = null
    if (score != null) out[key] = score
    if (mod == null && score != null) mod = Math.floor((score - 10) / 2)
    if (mod != null) out[`${key}Mod`] = mod
  }
  return out
}

function scrapePassives() {
  const out = {}
  const pairs = [
    [/perception/i, 'passivePerception'],
    [/insight/i, 'passiveInsight'],
    [/investigation/i, 'passiveInvestigation'],
  ]
  const nodes = document.querySelectorAll(
    '.ct-senses__callout, .ddbc-senses__callout, [class*="senses__callout"], [class*="senses"] [class*="callout"], [class*="Senses"] li, [class*="senses"] li',
  )
  for (const node of nodes) {
    const text = clean(node.textContent)
    for (const [pattern, key] of pairs) {
      if (!pattern.test(text) || out[key] != null) continue
      const value = num(text.match(/(\d+)\s*$/)?.[1] || text.match(/\d+/)?.[0])
      if (value != null) out[key] = value
    }
  }
  return out
}

function scrapeStats() {
  const levelText = firstText([
    '.ddbc-character-tidbits__level',
    '.ct-character-tidbits__level',
    '[class*="character-tidbits__level"]',
  ])
  const klass = firstText([
    '.ddbc-character-tidbits__classes',
    '.ct-character-tidbits__classes',
    '[class*="character-tidbits__classes"]',
  ])
  return {
    ...scrapeHp(),
    ac: firstNumber([
      '.ct-armor-class-box__value',
      '.ddbc-armor-class-box__value',
      '[class*="armor-class-box__value"]',
      '[class*="armor-class"] [class*="__value"]',
    ]),
    speed: firstNumber([
      '.ct-speed-box__box-value',
      '.ddbc-speed-box__box-value',
      '[class*="speed-box__box-value"]',
      '[class*="speed-box"] [class*="distance-number__number"]',
    ]),
    initiative: signedNumber([
      '.ct-initiative-box__value',
      '.ddbc-initiative-box__value',
      '[class*="initiative-box__value"]',
      '[class*="initiative-box"] [class*="signed-number"]',
      '.ct-combat-mobile__extra--initiative [class*="signed-number"]',
      '[class*="initiative"] [class*="signed-number"]',
    ]),
    level: num(levelText.replace(/level/i, '').match(/\d+/)?.[0]),
    klass: klass || null,
    ...scrapeAbilities(),
    ...scrapePassives(),
  }
}

let lastCharacterKey = ''
let characterBusy = false

async function sendCharacter() {
  const characterId = sheetCharacterId()
  if (!characterId || characterBusy) return
  const scraped = {
    characterId,
    name: characterName(),
    portraitUrl: portraitUrl(),
    stats: scrapeStats(),
  }
  const key = JSON.stringify(scraped)
  if (key === lastCharacterKey) return
  characterBusy = true
  try {
    const portrait = await portraitData(scraped.portraitUrl)
    lastCharacterKey = key
    sendRuntime({
      type: 'CHARACTER',
      character: { characterId, name: scraped.name, portrait, stats: scraped.stats },
    })
  } finally {
    characterBusy = false
  }
}

let characterTimer = 0
function requestCharacter() {
  window.clearTimeout(characterTimer)
  characterTimer = window.setTimeout(() => void sendCharacter(), 250)
}

// ---------- Rolls from the sheet's result popups ----------

const CARD_SELECTOR = '.dice_result, [class*="dice_result"], [class*="DiceResult"]'
/** How long a popup's text must hold still before it counts, so a total that animates in is read once. */
const SETTLE_MS = 300
/** Per popup: the text last sent, and text seen but not yet settled. */
const cardState = new WeakMap()
let baselineTaken = false

/**
 * Pairs the popup's breakdown ("17+7", or "17,4+7" with advantage) with the
 * formula's dice, so Crawler gets each die's face and can spot a natural 20.
 * Returns [] when the two do not line up rather than guessing.
 */
function diceFromBreakdown(formula, breakdown) {
  const groups = [...String(formula).matchAll(/(\d*)d(\d+)(k[hl]1)?/gi)].map((match) => ({
    count: Number(match[1] || 1),
    faces: Number(match[2]),
    keep: (match[3] || '').toLowerCase(),
  }))
  const values = (String(breakdown).match(/\d+/g) || []).map(Number)
  const wanted = groups.reduce((sum, group) => sum + group.count, 0)
  if (!groups.length || values.length < wanted) return []

  const dice = []
  let at = 0
  for (const group of groups) {
    const rolled = values.slice(at, at + group.count).map((value) => ({ faces: group.faces, value }))
    at += group.count
    // A face the die cannot show means the text was not a per-die breakdown.
    if (rolled.some((die) => die.value < 1 || die.value > die.faces)) return []
    if (group.keep && rolled.length > 1) {
      const best = group.keep === 'kh1' ? Math.max(...rolled.map((die) => die.value)) : Math.min(...rolled.map((die) => die.value))
      let kept = false
      for (const die of rolled) {
        if (!kept && die.value === best) kept = true
        else die.discarded = true
      }
    }
    dice.push(...rolled)
  }
  return dice
}

function readCard(card) {
  const title = textOf(card, '.dice_result__info__title, .dice_result__info__rolldetail, [class*="rolldetail"], [class*="RollDetail"]')
  const formula = textOf(card, '.dice_result__info__dicenotation, [class*="dicenotation"], [class*="DiceNotation"]')
  const breakdown = textOf(card, '.dice_result__info__breakdown, [class*="breakdown"], [class*="Breakdown"]')
  const kind = textOf(card, '.dice_result__rolltype, [class*="rolltype"], [class*="RollType"]')
  const totalText = textOf(card, '.dice_result__total-result, .dice_result__total, [class*="total-result"], [class*="TotalResult"]')
  const total = num(totalText.match(/-?\d+/)?.[0])
  if (total == null && !formula) return null
  return { title, formula, breakdown, kind, total }
}

function cardsIn(root) {
  const cards = new Set()
  const scope = root?.querySelectorAll ? root : document
  for (const node of scope.querySelectorAll(CARD_SELECTOR)) {
    const card = node.closest(CARD_SELECTOR) || node
    if (card instanceof HTMLElement) cards.add(card)
  }
  if (root instanceof HTMLElement && root.matches?.(CARD_SELECTOR)) {
    cards.add(root.closest(CARD_SELECTOR) || root)
  }
  // Only the outermost card counts; its children match the loose selectors too.
  return [...cards].filter((card) => !card.parentElement?.closest(CARD_SELECTOR))
}

let rollCounter = 0

/**
 * A popup is a new roll when it is a new element, or when an existing one now
 * shows different text. Identical repeat rolls still count because each one
 * gets its own popup. Text must settle first so an animating total is read once.
 */
function scanRolls(root) {
  const rolls = []
  const now = Date.now()
  let unsettled = false
  for (const card of cardsIn(root)) {
    const info = readCard(card)
    if (!info) continue
    const key = `${info.title}|${info.kind}|${info.formula}|${info.breakdown}|${info.total}`
    const state = cardState.get(card)
    // Popups already on screen when the sheet loads are history, not new rolls.
    if (!baselineTaken) {
      cardState.set(card, { sent: key, pending: null, since: 0 })
      continue
    }
    if (state?.sent === key) continue
    if (state?.pending !== key) {
      cardState.set(card, { sent: state?.sent ?? null, pending: key, since: now })
      unsettled = true
      continue
    }
    if (now - state.since < SETTLE_MS) {
      unsettled = true
      continue
    }
    cardState.set(card, { sent: key, pending: null, since: 0 })
    rollCounter += 1
    const dice = diceFromBreakdown(info.formula, info.breakdown)
    rolls.push({
      id: `ddb-page:${sheetCharacterId()}:${Date.now()}:${rollCounter}`,
      source: 'ddb',
      character: characterName(),
      characterId: sheetCharacterId() || undefined,
      title: [info.title, info.kind].filter(Boolean).join(' · ') || 'Roll',
      formula: info.formula || `total ${info.total}`,
      total: info.total ?? 0,
      dice,
      kind: info.kind || undefined,
      at: Date.now(),
    })
  }
  if (rolls.length) sendRuntime({ type: 'DICE_ROLL', rolls })
  if (unsettled) window.setTimeout(() => scanRolls(document), SETTLE_MS + 20)
}

let scanTimer = 0
function requestScan() {
  window.clearTimeout(scanTimer)
  scanTimer = window.setTimeout(() => scanRolls(document), 40)
}

// ---------- Start watching ----------

function start() {
  scanRolls(document)
  baselineTaken = true
  void sendCharacter()

  const observer = new MutationObserver(() => {
    requestScan()
    requestCharacter()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })

  // Safety nets for changes the observer coalesces away; both only read the page.
  window.setInterval(() => scanRolls(document), ROLL_SCAN_MS)
  window.setInterval(() => void sendCharacter(), CHARACTER_POLL_MS)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
