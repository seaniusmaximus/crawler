const crawlerTabs = new Set()
const pending = []

function remember(tabId) {
  if (tabId != null) crawlerTabs.add(tabId)
}

function forget(tabId) {
  crawlerTabs.delete(tabId)
}

function queue(message) {
  pending.push(message)
  if (pending.length > 20) pending.shift()
}

async function crawlerTabIds(extraTabId) {
  const ids = new Set(crawlerTabs)
  if (extraTabId != null) ids.add(extraTabId)
  try {
    const tabs = await chrome.tabs.query({
      url: ['http://localhost/*', 'http://127.0.0.1/*'],
    })
    for (const tab of tabs) {
      if (tab.id != null) ids.add(tab.id)
    }
  } catch {
    // host permissions should allow this; ignore if Chrome refuses
  }
  return ids
}

async function deliver(message, extraTabId) {
  let delivered = 0
  const ids = await crawlerTabIds(extraTabId)

  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const reply = await chrome.tabs.sendMessage(id, message)
        if (reply?.ok) {
          remember(id)
          delivered += 1
        } else {
          forget(id)
        }
      } catch {
        forget(id)
      }
    }),
  )

  return delivered
}

async function broadcast(message) {
  const delivered = await deliver(message)
  if (delivered === 0) queue(message)
  else pending.length = 0
}

async function flush(tabId) {
  remember(tabId)
  const waiting = pending.splice(0, pending.length)
  for (const message of waiting) {
    const delivered = await deliver(message, tabId)
    if (delivered === 0) queue(message)
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id
  if (message?.type === 'CRAWLER_HELLO') {
    remember(tabId)
    flush(tabId)
    return false
  }
  if (message?.type === 'DICE_ROLL' || message?.type === 'CHARACTER') {
    broadcast(message)
    return false
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  forget(tabId)
})
