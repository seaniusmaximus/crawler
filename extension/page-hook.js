(() => {
  if (window.__crawlerDiceHook) return
  window.__crawlerDiceHook = true

  const CHANNEL = 'CRAWLER_DDB_ROLL'
  const CHARACTER = 'CRAWLER_DDB_CHARACTER'
  const BROKER = Symbol.for('@dndbeyond/message-broker-lib')
  const B20_BRIDGE = '__b20_ddb_dice_mb_bridge__'
  const seen = new Set()
  let scanTimer = 0

  function emit(rolls) {
    let next = (Array.isArray(rolls) ? rolls : []).filter(Boolean)
    if (!next.length) return
    try {
      next = JSON.parse(JSON.stringify(next))
    } catch {
      return
    }
    window.postMessage({ type: CHANNEL, rolls: next }, '*')
  }

  function remember(id) {
    if (!id) return false
    if (seen.has(id)) return true
    seen.add(id)
    if (seen.size > 120) seen.delete(seen.values().next().value)
    return false
  }

  function sheetCharacterId() {
    return (window.location.pathname.match(/\/characters\/(\d+)/) || [])[1] || ''
  }

  function characterName() {
    const node =
      document.querySelector('.ddbc-character-tidbits__heading h1') ||
      document.querySelector('.ct-character-tidbits__heading h1') ||
      document.querySelector('[class*="character-tidbits"] h1')
    const fromDom = (node?.textContent || '').trim()
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

  let lastCharacter = ''

  function firstText(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector)
      const text = (node?.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) return text
    }
    return ''
  }

  function firstNumber(selectors) {
    return num(String(firstText(selectors)).replace(/,/g, '').match(/-?\d+/)?.[0])
  }

  function signedNumber(selectors) {
    const text = firstText(selectors)
    const match = text.replace(/,/g, '').match(/([+-]?)(\d+)/)
    if (!match) return null
    const value = Number(match[2])
    return match[1] === '-' ? -value : value
  }

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
      const text = (item.textContent || '').replace(/\s+/g, ' ').trim()
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
        const match = (node.textContent || '').replace(/\s+/g, ' ').match(/(-?\d+)\s*\/\s*(-?\d+)/)
        if (!match) continue
        const current = num(match[1])
        const max = num(match[2])
        if (!looksLikeHpPair(current, max)) continue
        if (hp == null) hp = current
        if (hpMax == null) hpMax = max
        break
      }
    }

    return { hp, hpMax, hpTemp }
  }

  const ABILITY_ABBR = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' }

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
      const abbr = (
        node.querySelector(
          '.ct-ability-summary__abbr, .ddbc-ability-summary__abbr, [class*="ability-summary__abbr"]',
        )?.textContent || ''
      )
        .trim()
        .toLowerCase()
      const key = ABILITY_ABBR[abbr]
      if (!key || out[key] != null) continue
      const primary = (
        node.querySelector(
          '.ct-ability-summary__primary, .ddbc-ability-summary__primary, [class*="ability-summary__primary"]',
        )?.textContent || ''
      ).replace(/\s+/g, ' ')
      const secondary = (
        node.querySelector(
          '.ct-ability-summary__secondary, .ddbc-ability-summary__secondary, [class*="ability-summary__secondary"]',
        )?.textContent || ''
      ).replace(/\s+/g, ' ')
      let mod = signedFrom(primary)
      let score = unsignedFrom(secondary)
      if (mod == null) {
        mod = signedFrom(secondary)
        score = unsignedFrom(primary)
      }
      if (score == null && unsignedFrom(secondary) != null && unsignedFrom(secondary) >= 8) {
        score = unsignedFrom(secondary)
      }
      if (score == null && unsignedFrom(primary) != null && unsignedFrom(primary) >= 8) {
        score = unsignedFrom(primary)
      }
      if (score != null) out[key] = score
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
      const text = (node.textContent || '').replace(/\s+/g, ' ')
      for (const [pattern, key] of pairs) {
        if (!pattern.test(text) || out[key] != null) continue
        const value = num(text.match(/(\d+)\s*$/)?.[1] || text.match(/\d+/)?.[0])
        if (value != null) out[key] = value
      }
    }
    return out
  }

  function scrapeStats() {
    const hp = scrapeHp()
    const levelText = firstText([
      '.ddbc-character-tidbits__level',
      '.ct-character-tidbits__level',
      '[class*="character-tidbits__level"]',
    ])
    const klass = firstText([
      '.ddbc-character-tidbits__classes',
      '.ct-character-tidbits__classes',
      '[class*="character-tidbits__classes"]',
    ]).replace(/\s+/g, ' ')
    return {
      hp: hp.hp,
      hpMax: hp.hpMax,
      hpTemp: hp.hpTemp,
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

  function emitCharacter() {
    const characterId = sheetCharacterId()
    if (!characterId) return
    const character = {
      characterId,
      name: characterName(),
      portrait: portraitUrl() || null,
      stats: scrapeStats(),
    }
    const key = JSON.stringify(character)
    if (key === lastCharacter) return
    lastCharacter = key
    window.postMessage({ type: CHARACTER, character }, '*')
  }

  let characterTimer = 0
  function requestCharacter() {
    window.clearTimeout(characterTimer)
    characterTimer = window.setTimeout(emitCharacter, 250)
  }

  function num(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function facesOf(value) {
    const n = num(String(value || '').replace(/^d/i, ''))
    return n && n > 0 ? n : 0
  }

  function diceFromSet(set) {
    const fallback = facesOf(set?.dieType)
    return (Array.isArray(set?.dice) ? set.dice : []).map((die) => ({
      faces: facesOf(die.dieType) || fallback,
      value: num(die.dieValue) ?? 0,
    }))
  }

  function formulaFrom(dice, modifier) {
    const groups = new Map()
    for (const die of dice) {
      groups.set(die.faces, (groups.get(die.faces) || 0) + 1)
    }
    const body = [...groups.entries()]
      .filter(([faces]) => faces > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([faces, count]) => `${count}d${faces}`)
      .join('+')
    const mod = modifier || 0
    const sign = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''
    return `${body || 'roll'}${sign}`
  }

  function fromDdbRoll(roll, meta) {
    const notation = roll?.diceNotation || {}
    const result = roll?.result || {}
    const dice = (Array.isArray(notation.set) ? notation.set : []).flatMap(diceFromSet)
    const modifier = num(notation.constant ?? result.constant)
    const total = num(result.total)
    const formula = String(roll?.diceNotationStr || '').trim() || formulaFrom(dice, modifier)
    if (total == null && !dice.length && !formula) return null
    const kind = String(roll?.rollKind || '').trim()
    const type = String(roll?.rollType || '').trim()
    return {
      id: `ddb:${meta.id}:${meta.index}`,
      source: 'ddb',
      character: meta.character,
      characterId: meta.characterId || undefined,
      title: [meta.action, type, kind].filter(Boolean).join(' · ') || 'Roll',
      formula,
      total: total ?? dice.reduce((sum, die) => sum + die.value, 0) + (modifier || 0),
      dice,
      modifier: modifier ?? undefined,
      kind: kind || undefined,
      at: meta.at,
    }
  }

  function fromFulfilled(message) {
    const data = message?.data
    if (!data) return []
    const rolls = Array.isArray(data.rolls) ? data.rolls : []
    if (!rolls.length) return []
    const sheetId = sheetCharacterId()
    const entityId = String(data.entityId || data.context?.entityId || '')
    if (sheetId && entityId && String(entityId) !== sheetId) return []
    const id = String(message.id || data.rollId || '')
    if (remember(id)) return []
    const meta = {
      id: id || `anon:${Date.now()}`,
      character: data.context?.name || characterName(),
      characterId: sheetId || entityId || undefined,
      action: String(data.action || 'Roll'),
      at: num(message.dateTime) || Date.now(),
    }
    return rolls
      .map((roll, index) => fromDdbRoll(roll, { ...meta, index }))
      .filter(Boolean)
  }

  function partDice(part) {
    if (!part || typeof part !== 'object') return []
    const faces = num(part.faces) || 0
    return (Array.isArray(part.rolls) ? part.rolls : []).map((entry) => ({
      faces,
      value: num(entry?.roll ?? entry?.value) ?? 0,
      discarded: entry?.discarded ? true : undefined,
    }))
  }

  function fromBeyond20(request) {
    if (!request || typeof request !== 'object') return []
    const character =
      request.character?.name ||
      request.character?.characterName ||
      (typeof request.character === 'string' ? request.character : '') ||
      characterName()
    const title = request.title || request.action || request.request?.action || 'Roll'
    const rolls = request.rolls || request.request?.rolls || []
    const stamp = Date.now()
    const id = String(request.id || request.action || '')
    if (id && remember(`b20:${id}`)) return []
    if (Array.isArray(rolls) && rolls.length) {
      return rolls.map((roll, index) => ({
        id: `b20:${id || stamp}:${index}`,
        source: 'ddb',
        character: String(character),
        characterId: sheetCharacterId() || undefined,
        title: String(roll.type || title),
        formula: String(roll.formula || ''),
        total: num(roll.total) ?? 0,
        dice: (Array.isArray(roll.parts) ? roll.parts : []).flatMap(partDice),
        at: stamp,
      }))
    }
    return []
  }

  function hookBroker() {
    const mb = window[BROKER]
    if (!mb) return false
    if (typeof mb.subscribe === 'function' && !mb.__crawlerDiceSub) {
      mb.__crawlerDiceSub = true
      mb.subscribe((message) => {
        if (message?.eventType === 'dice/roll/fulfilled') emit(fromFulfilled(message))
      })
    }
    if (typeof mb.dispatch === 'function' && !mb.__crawlerDiceDispatch) {
      const original = mb.dispatch.bind(mb)
      mb.__crawlerDiceDispatch = true
      mb.dispatch = (message) => {
        if (message?.eventType === 'dice/roll/fulfilled') emit(fromFulfilled(message))
        return original(message)
      }
    }
    return Boolean(mb.__crawlerDiceSub || mb.__crawlerDiceDispatch)
  }

  function hookFetch() {
    if (window.__crawlerFetchHook || typeof window.fetch !== 'function') return
    window.__crawlerFetchHook = true
    const original = window.fetch.bind(window)
    window.fetch = async function crawlerFetch(...args) {
      const response = await original(...args)
      try {
        const clone = response.clone()
        clone
          .text()
          .then((text) => {
            if (!/diceNotation|dice\/roll|dieValue|dicenotation/i.test(text)) return
            const found = []
            walk(JSON.parse(text), found)
            if (found.length) emit(found)
          })
          .catch(() => {})
      } catch {
        // Ignore parse failures and leave the original response intact.
      }
      return response
    }
  }

  function walk(value, found) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, found))
      return
    }
    if (value.eventType === 'dice/roll/fulfilled') {
      found.push(...fromFulfilled(value))
      return
    }
    if (value.diceNotation && value.result) {
      const rollId = String(value.rollId || value.id || '')
      if (remember(`fetch:${rollId}:${value.result?.total}`)) return
      const roll = fromDdbRoll(value, {
        id: rollId || `fetch:${Date.now()}`,
        index: found.length,
        character: characterName(),
        action: String(value.rollType || value.action || 'Roll'),
        at: Date.now(),
      })
      if (roll) found.push(roll)
      return
    }
    for (const nested of Object.values(value)) walk(nested, found)
  }

  function textOf(root, selector) {
    return (root.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function fingerprint(node) {
    const title = textOf(node, '.dice_result__info__title, .dice_result__info__rolldetail, [class*="rolldetail"], [class*="RollDetail"]')
    const formula = textOf(node, '.dice_result__info__dicenotation, [class*="dicenotation"], [class*="DiceNotation"]')
    const kind = textOf(node, '.dice_result__rolltype, [class*="rolltype"], [class*="RollType"]')
    const total = textOf(node, '.dice_result__total-result, .dice_result__total, [class*="total-result"], [class*="TotalResult"]')
    return { title, formula, kind, total, key: `${title}|${kind}|${formula}|${total}` }
  }

  function parseResultNode(node) {
    if (!(node instanceof HTMLElement)) return null
    const info = fingerprint(node)
    const total = num(info.total)
    if (total == null && !info.formula) return null
    if (node.dataset.crawlerDice === info.key) return null
    node.dataset.crawlerDice = info.key
    if (remember(`dom:${info.key}`)) return null
    return {
      id: `ddb-dom:${info.key}`,
      source: 'ddb',
      character: characterName(),
      title: [info.title, info.kind].filter(Boolean).join(' · ') || 'Roll',
      formula: info.formula || `total ${total}`,
      total: total ?? 0,
      dice: [],
      kind: info.kind || undefined,
      at: Date.now(),
    }
  }

  function collectCards(root) {
    const cards = new Set()
    const scope = root?.querySelectorAll ? root : document
    const selector =
      '.dice_result, .dice_result__total-result, [class*="dice_result"], [class*="DiceResult"]'
    if (scope.querySelectorAll) {
      for (const node of scope.querySelectorAll(selector)) {
        const card =
          node.closest('.dice_result, [class*="dice_result"], [class*="DiceResult"]') || node
        if (card instanceof HTMLElement) cards.add(card)
      }
    }
    if (root instanceof HTMLElement && root.matches?.(selector)) {
      const card =
        root.closest('.dice_result, [class*="dice_result"], [class*="DiceResult"]') || root
      if (card instanceof HTMLElement) cards.add(card)
    }
    return cards
  }

  function scan(root) {
    const rolls = []
    for (const card of collectCards(root)) {
      const roll = parseResultNode(card)
      if (roll) rolls.push(roll)
    }
    if (rolls.length) emit(rolls)
  }

  function requestScan(root) {
    window.clearTimeout(scanTimer)
    scanTimer = window.setTimeout(() => scan(root || document), 40)
  }

  function hookDom() {
    requestScan(document.documentElement)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          requestScan(mutation.target.parentElement || document)
          continue
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) requestScan(node)
        }
        if (mutation.target instanceof HTMLElement) requestScan(mutation.target)
      }
      requestCharacter()
    })
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    window.setInterval(() => scan(document), 1500)
  }

  function hookBeyond20() {
    for (const name of ['Beyond20_RenderedRoll', 'Beyond20_roll']) {
      document.addEventListener(name, (event) => {
        emit(fromBeyond20(event.detail?.[0] ?? event.detail))
      })
    }
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.[B20_BRIDGE]) return
      const message = event.data.message
      if (message?.eventType === 'dice/roll/fulfilled') emit(fromFulfilled(message))
    })
  }

  hookFetch()
  hookBeyond20()
  emitCharacter()
  window.setInterval(emitCharacter, 2000)

  function pollBroker(delay) {
    window.setTimeout(() => {
      hookBroker()
      pollBroker(delay < 2000 ? Math.min(2000, delay + 100) : 2000)
    }, delay)
  }
  pollBroker(250)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookDom, { once: true })
  } else {
    hookDom()
  }
})()
