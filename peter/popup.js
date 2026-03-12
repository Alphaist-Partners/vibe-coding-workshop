// popup.js — 历史记录查看器

const HISTORY_KEY = 'cardHistory';

// =====================================================================
// Storage helpers
// =====================================================================

async function loadHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return result[HISTORY_KEY] || [];
}

async function deleteEntry(id) {
  const history = await loadHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.filter((item) => item.id !== id),
  });
}

// =====================================================================
// 剪贴板（从 dataURL 复制 PNG 到剪贴板）
// =====================================================================

/**
 * 将 JPEG dataURL 画到临时 canvas，再导出为 PNG blob 复制
 * （clipboard API 在 popup 上下文中可直接使用）
 */
function copyDataUrlToClipboard(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('toBlob 失败'));
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

// =====================================================================
// 时间格式化
// =====================================================================

function formatTime(isoString) {
  const date = new Date(isoString);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)          return '刚刚';
  if (diff < 3_600_000)       return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000)      return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000)  return `${Math.floor(diff / 86_400_000)} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// =====================================================================
// HTML 转义
// =====================================================================

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// 渲染
// =====================================================================

function renderHistory(history) {
  const listEl    = document.getElementById('history-list');
  const emptyEl   = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading-state');
  const countEl   = document.getElementById('count-badge');

  // 隐藏 loading
  loadingEl.classList.add('hidden');

  // 更新统计
  countEl.textContent = `共生成 ${history.length} 张卡片`;

  if (history.length === 0) {
    listEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  listEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  // 渲染列表
  listEl.innerHTML = history
    .map(
      (item) => `
    <div class="history-item" data-id="${item.id}">
      <img
        class="item-thumb"
        src="${esc(item.imageDataUrl)}"
        alt="卡片预览"
        loading="lazy"
      />
      <div class="item-body">
        <p class="item-text">${esc(item.text)}</p>
        <p class="item-source">${esc(item.pageTitle)}</p>
        <div class="item-footer">
          <span class="item-time">${formatTime(item.createdAt)}</span>
          <div class="item-actions">
            <button class="btn-action btn-copy" data-id="${item.id}" title="复制到剪贴板">📋</button>
            <button class="btn-action btn-delete" data-id="${item.id}" title="删除">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  // ---- 绑定复制按钮 ----
  listEl.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id   = Number(btn.dataset.id);
      const item = history.find((h) => h.id === id);
      if (!item) return;

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳';

      try {
        await copyDataUrlToClipboard(item.imageDataUrl);
        btn.textContent = '✅';
        btn.classList.add('btn-copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('btn-copied');
          btn.disabled = false;
        }, 1600);
      } catch (err) {
        btn.textContent = '❌';
        setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
        }, 1600);
        console.error('[划词卡片] 复制失败：', err.message);
      }
    });
  });

  // ---- 绑定删除按钮 ----
  listEl.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id      = Number(btn.dataset.id);
      const itemEl  = btn.closest('.history-item');

      // 播放退出动画后再删除 DOM 和 storage
      itemEl.classList.add('removing');
      itemEl.addEventListener('animationend', async () => {
        itemEl.remove();
        await deleteEntry(id);

        // 更新计数
        const remaining = listEl.querySelectorAll('.history-item').length;
        countEl.textContent = `共生成 ${remaining} 张卡片`;

        // 全删完显示空状态
        if (remaining === 0) {
          listEl.classList.add('hidden');
          emptyEl.classList.remove('hidden');
        }
      }, { once: true });
    });
  });
}

// =====================================================================
// 入口
// =====================================================================

async function init() {
  try {
    const history = await loadHistory();
    renderHistory(history);
  } catch (err) {
    console.error('[划词卡片] 加载历史失败：', err);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  }
}

init();
