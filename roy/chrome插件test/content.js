'use strict';
/* global CardRenderer, CARD_THEMES, chrome */

// Guard against double-injection
if (window.__cardPluginLoaded) {
  // already loaded, skip
} else {
  window.__cardPluginLoaded = true;

  (() => {
    // ─── State ───────────────────────────────────────────────────────────────

    let floatBtn = null;
    let currentText = '';
    let previewEl = null;
    let currentTheme = 0;

    // Load saved theme preference
    chrome.storage.local.get('activeTheme', ({ activeTheme }) => {
      if (typeof activeTheme === 'number') currentTheme = activeTheme;
    });

    // ─── Floating Button ─────────────────────────────────────────────────────

    function getFloatBtn() {
      if (floatBtn) return floatBtn;
      floatBtn = document.createElement('button');
      floatBtn.id = '__sc-fab';
      floatBtn.title = '生成卡片';
      floatBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 21V9"/>
        </svg>
      `;
      document.body.appendChild(floatBtn);
      // mousedown prevents selection loss
      floatBtn.addEventListener('mousedown', e => e.preventDefault());
      floatBtn.addEventListener('click', () => {
        if (currentText) {
          hideFloatBtn();
          generateCard(currentText);
        }
      });
      return floatBtn;
    }

    function showFloatBtn(rect) {
      const btn = getFloatBtn();
      const sx = window.scrollX, sy = window.scrollY;
      let left = rect.right + sx + 8;
      let top = rect.top + sy - 38;
      // Stay inside viewport
      const vw = document.documentElement.clientWidth;
      if (left + 44 > vw + sx) left = rect.left + sx - 50;
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;
      btn.classList.add('__sc-visible');
    }

    function hideFloatBtn() {
      floatBtn?.classList.remove('__sc-visible');
    }

    // ─── Selection Detection ─────────────────────────────────────────────────

    document.addEventListener('mouseup', e => {
      if (floatBtn?.contains(e.target)) return;
      if (previewEl?.contains(e.target)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? '';
        if (text.length >= 5) {
          currentText = text;
          const range = sel.getRangeAt(0);
          showFloatBtn(range.getBoundingClientRect());
        } else {
          currentText = '';
          hideFloatBtn();
        }
      }, 20);
    });

    document.addEventListener('mousedown', e => {
      if (floatBtn?.contains(e.target)) return;
      if (previewEl?.contains(e.target)) return;
      hideFloatBtn();
    });

    // ─── Context Menu Message ────────────────────────────────────────────────

    chrome.runtime.onMessage.addListener(msg => {
      if (msg.action === 'generateCard' && msg.text) {
        generateCard(msg.text);
      }
    });

    // ─── Card Generation ─────────────────────────────────────────────────────

    async function generateCard(text) {
      const renderer = new CardRenderer();
      showToast('正在生成…', 'info');

      let canvas;
      try {
        canvas = await renderer.render(text, location.href, document.title, currentTheme);
      } catch (err) {
        showToast('生成失败 :(', 'error');
        console.error('[划词卡片]', err);
        return;
      }

      // Copy to clipboard
      let copied = false;
      try {
        await renderer.copyToClipboard(canvas);
        copied = true;
      } catch (err) {
        console.warn('[划词卡片] clipboard write failed:', err);
      }

      // Save thumbnail to history (fire-and-forget)
      const thumbDataUrl = renderer.getThumbnailDataURL(canvas);
      chrome.runtime.sendMessage({
        action: 'saveCard',
        card: {
          text: text.slice(0, 200),
          url: location.href,
          title: document.title,
          thumbDataUrl,
        },
      });

      showPreview(canvas, renderer, text, copied);
    }

    // ─── Preview Overlay ─────────────────────────────────────────────────────

    function showPreview(canvas, renderer, text, copied) {
      removePreview();

      const dataUrl = renderer.getDataURL(canvas);

      previewEl = document.createElement('div');
      previewEl.id = '__sc-overlay';

      const themeBtns = CARD_THEMES.map(
        t =>
          `<button class="__sc-theme-dot ${t.id === currentTheme ? '__sc-active' : ''}"
                   data-theme="${t.id}"
                   title="${t.name}"
                   style="background:linear-gradient(135deg,${t.grad[0]},${t.grad[t.grad.length - 1]})">
           </button>`
      ).join('');

      previewEl.innerHTML = `
        <div class="__sc-modal">
          <div class="__sc-modal-header">
            <span class="__sc-status ${copied ? '__sc-ok' : '__sc-warn'}">
              ${copied ? '✅ 已复制到剪贴板' : '⚠️ 复制失败，请手动下载'}
            </span>
            <div class="__sc-themes">${themeBtns}</div>
          </div>
          <div class="__sc-img-wrap">
            <img class="__sc-img" src="${dataUrl}" alt="卡片预览" />
          </div>
          <div class="__sc-modal-footer">
            <button class="__sc-btn __sc-btn-dl" id="__sc-btn-dl">💾 下载</button>
            <button class="__sc-btn __sc-btn-close" id="__sc-btn-close">✕ 关闭</button>
          </div>
        </div>
      `;

      document.body.appendChild(previewEl);
      requestAnimationFrame(() => previewEl?.classList.add('__sc-visible'));

      // Theme switcher — re-render on click
      previewEl.querySelectorAll('.__sc-theme-dot').forEach(btn => {
        btn.addEventListener('click', async () => {
          const theme = parseInt(btn.dataset.theme, 10);
          if (theme === currentTheme) return;
          currentTheme = theme;
          chrome.storage.local.set({ activeTheme: theme });
          removePreview();
          await generateCard(text);
        });
      });

      document.getElementById('__sc-btn-dl').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `card-${Date.now()}.png`;
        a.click();
      });

      document.getElementById('__sc-btn-close').addEventListener('click', removePreview);

      previewEl.addEventListener('click', e => {
        if (e.target === previewEl) removePreview();
      });
    }

    function removePreview() {
      if (!previewEl) return;
      previewEl.classList.remove('__sc-visible');
      const el = previewEl;
      previewEl = null;
      setTimeout(() => el.remove(), 300);
    }

    // ─── Toast ───────────────────────────────────────────────────────────────

    function showToast(msg, type = 'info') {
      const t = document.createElement('div');
      t.className = `__sc-toast __sc-toast-${type}`;
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add('__sc-visible'));
      setTimeout(() => {
        t.classList.remove('__sc-visible');
        setTimeout(() => t.remove(), 300);
      }, 2200);
    }
  })();
}
