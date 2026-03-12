'use strict';

// ─── Context Menu ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'make-card',
    title: '生成划词卡片 ✂️',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'make-card') return;
  chrome.tabs.sendMessage(tab.id, {
    action: 'generateCard',
    text: info.selectionText,
  });
});

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.action) {
    case 'fetchQR':
      fetchQR(msg.url).then(respond);
      return true; // keep channel open for async response

    case 'saveCard':
      saveCard(msg.card).then(respond);
      return true;

    case 'getHistory':
      getHistory().then(respond);
      return true;

    case 'deleteCard':
      deleteCard(msg.id).then(respond);
      return true;

    case 'clearHistory':
      clearHistory().then(respond);
      return true;
  }
});

// ─── QR Code Proxy ───────────────────────────────────────────────────────────
// Fetch from service worker to bypass page CSP restrictions

async function fetchQR(url) {
  try {
    const apiUrl =
      `https://api.qrserver.com/v1/create-qr-code/` +
      `?size=80x80&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=222222&qzone=1&format=png`;
    const res = await fetch(apiUrl);
    if (!res.ok) return { dataUrl: null };
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return { dataUrl: `data:image/png;base64,${btoa(binary)}` };
  } catch {
    return { dataUrl: null };
  }
}

// ─── History Storage ─────────────────────────────────────────────────────────

async function saveCard(card) {
  const { cards = [] } = await chrome.storage.local.get('cards');
  cards.unshift({ id: Date.now(), savedAt: Date.now(), ...card });
  if (cards.length > 50) cards.length = 50;
  await chrome.storage.local.set({ cards });
  return { ok: true };
}

async function getHistory() {
  const { cards = [] } = await chrome.storage.local.get('cards');
  return cards;
}

async function deleteCard(id) {
  const { cards = [] } = await chrome.storage.local.get('cards');
  await chrome.storage.local.set({ cards: cards.filter(c => c.id !== id) });
  return { ok: true };
}

async function clearHistory() {
  await chrome.storage.local.set({ cards: [] });
  return { ok: true };
}
