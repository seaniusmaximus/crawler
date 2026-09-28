const HELLO = 'CRAWLER_DICE_HELLO'
const READY = 'CRAWLER_DICE_READY'
const ROLL = 'CRAWLER_DICE_ROLL'
const CHARACTER = 'CRAWLER_DDB_CHARACTER'

let booted = false

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
    // Isolated world is gone; this tab needs a refresh after an extension reload.
  }
}

function isCrawlerPage() {
  return Boolean(document.querySelector('[data-crawler], [data-dice-tray]'))
}

function announce() {
  if (!isCrawlerPage()) return
  window.postMessage({ type: HELLO }, '*')
}

function toPage(type, payload) {
  if (!isCrawlerPage()) return false
  const safe = cloneJson(payload)
  if (safe == null) return false
  try {
    window.postMessage({ type, ...safe }, '*')
  } catch {
    return false
  }
  announce()
  return true
}

function helloBackground() {
  sendRuntime({ type: 'CRAWLER_HELLO' })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DICE_ROLL') {
    sendResponse({ ok: toPage(ROLL, { rolls: message.rolls ?? [] }) })
    return false
  }
  if (message?.type === 'CHARACTER') {
    sendResponse({ ok: toPage(CHARACTER, { character: message.character }) })
    return false
  }
  return false
})

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== READY) return
  helloBackground()
  announce()
})

function boot() {
  if (!isCrawlerPage()) return false
  if (!booted) {
    booted = true
    window.setInterval(() => {
      helloBackground()
      announce()
    }, 3000)
  }
  helloBackground()
  announce()
  return true
}

if (!boot()) {
  const findTimer = window.setInterval(() => {
    if (boot()) window.clearInterval(findTimer)
  }, 400)
}
