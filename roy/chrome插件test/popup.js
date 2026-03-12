'use strict';

// ─── Theme definitions (mirrors card-renderer.js) ────────────────────────────

const THEMES = [
  { id: 0, name: '深邃',  grad: ['#0d0015', '#2e0060'], accent: '#c084fc' },
  { id: 1, name: '紫韵',  grad: ['#1e0040', '#7c3aed'], accent: '#fde68a' },
  { id: 2, name: '薰衣草', grad: ['#3b0764', '#a78bfa'], accent: '#ffffff' },
  { id: 3, name: '雅白',  grad: ['#f5f0ff', '#ede9fe'], accent: '#7c3aed' },
];

// ─── State ───────────────────────────────────────────────────────────────────

let cards = [];
let activeTheme = 0;

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const data = await chrome.storage.local.get(['cards', 'activeTheme']);
  cards = data.cards ?? [];
  activeTheme = data.activeTheme ?? 0;

  renderThemePicker();
  renderHistory();
}

// ─── Theme Picker ─────────────────────────────────────────────────────────────

function renderThemePicker() {
  const picker = document.getElementById('theme-picker');
  picker.innerHTML = THEMES.map(t => `
    <button
      class="theme-swatch ${t.id === activeTheme ? 'active' : ''}"
      data-id="${t.id}"
      title="${t.name}"
      style="background: linear-gradient(135deg, ${t.grad[0]}, ${t.grad[1]});
             --accent: ${t.accent};">
    </button>
  `).join('');

  picker.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTheme = parseInt(btn.dataset.id, 10);
      chrome.storage.local.set({ activeTheme });
      picker.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ─── History List ─────────────────────────────────────────────────────────────

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('count');

  countEl.textContent = cards.length;

  if (cards.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  list.innerHTML = cards.map(card => `
    <div class="card-item" data-id="${card.id}">
      <img class="card-thumb" src="${card.thumbDataUrl}" alt="卡片" />
      <div class="card-info">
        <p class="card-text">${escapeHtml(card.text.slice(0, 80))}${card.text.length > 80 ? '…' : ''}</p>
        <a class="card-url" href="${card.url}" target="_blank" title="${escapeHtml(card.url)}">
          ${escapeHtml(tryHostname(card.url))}
        </a>
        <span class="card-date">${formatDate(card.savedAt)}</span>
      </div>
      <div class="card-actions">
        <button class="btn-copy" data-id="${card.id}" title="复制图片">📋</button>
        <button class="btn-delete" data-id="${card.id}" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyCard(parseInt(btn.dataset.id, 10)));
  });

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCard(parseInt(btn.dataset.id, 10)));
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function copyCard(id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  const btn = document.querySelector(`.btn-copy[data-id="${id}"]`);
  btn.textContent = '⏳';
  btn.disabled = true;

  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = card.thumbDataUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    await new Promise((res, rej) => {
      canvas.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          res();
        } catch (e) { rej(e); }
      }, 'image/png');
    });

    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = '📋'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error('[划词卡片] copy failed:', err);
    btn.textContent = '❌';
    setTimeout(() => { btn.textContent = '📋'; btn.disabled = false; }, 1500);
  }
}

async function deleteCard(id) {
  await chrome.runtime.sendMessage({ action: 'deleteCard', id });
  cards = cards.filter(c => c.id !== id);
  renderHistory();
}

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (cards.length === 0) return;
  if (!confirm(`确认清空全部 ${cards.length} 张历史卡片？`)) return;
  await chrome.runtime.sendMessage({ action: 'clearHistory' });
  cards = [];
  renderHistory();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tryHostname(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

function formatDate(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();
