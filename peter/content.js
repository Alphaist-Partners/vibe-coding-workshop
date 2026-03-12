// content.js - Content Script

// =====================================================================
// 工具函数
// =====================================================================

/**
 * 自动换行 —— 支持中英文混排
 * 逐字符检测宽度，保证 CJK 和拉丁字母都能正确折行
 */
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const lines = [];
  let line = '';
  for (const char of text) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * 加载图片，返回 Promise<HTMLImageElement>
 * 设置 crossOrigin = 'anonymous'，确保画入 canvas 后不污染（可正常调用 toBlob/toDataURL）
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败: ' + src));
    img.src = src;
  });
}

/**
 * 获取选中文字 + 前后各 contextLength 字的上下文
 * 向上找最近的块级元素，从其 textContent 截取上下文
 */
function getSelectionWithContext(contextLength = 100) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const selected = selection.toString().trim();
  if (!selected) return null;

  const range = selection.getRangeAt(0);
  const BLOCK_TAGS = new Set(['P', 'DIV', 'ARTICLE', 'SECTION', 'MAIN', 'LI', 'BLOCKQUOTE', 'TD']);
  let container = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;
  for (let i = 0; i < 5; i++) {
    if (!container || !container.parentNode) break;
    if (BLOCK_TAGS.has(container.tagName)) break;
    container = container.parentNode;
  }

  const fullText = container?.textContent || '';
  const idx = fullText.indexOf(selected);
  if (idx === -1) return { selected, before: '', after: '' };

  const before = fullText.slice(Math.max(0, idx - contextLength), idx).trim();
  const after  = fullText.slice(idx + selected.length, idx + selected.length + contextLength).trim();
  return { selected, before, after };
}

// =====================================================================
// Canvas 卡片绘制
// =====================================================================

/**
 * 绘制分享卡片，返回内存中的 HTMLCanvasElement
 *
 * 布局（从上到下）：
 *   padding-top
 *   [上文  — 灰色 14px]
 *   [选中文字 — 黑色 20px 加粗 + 左侧蓝色竖线]
 *   [下文  — 灰色 14px]
 *   分隔线
 *   [页面标题 + 提示语]  /  [二维码 80×80]
 *   padding-bottom
 */
async function drawCard({ selected, before, after, title, url }) {
  // ---- 布局常量 ----------------------------------------
  const W        = 720;
  const PH       = 40;
  const PV       = 40;
  const TW       = W - PH * 2;
  const LH_SM    = 22;
  const LH_LG    = 32;
  const GAP      = 16;
  const BAR_W    = 4;
  const BAR_GAP  = 12;
  const SEL_TW   = TW - BAR_W - BAR_GAP;
  const FOOTER_H = 100;
  const QR_SIZE  = 80;

  const FONT_SM  = `14px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_LG  = `bold 20px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_TTL = `600 14px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_SUB = `12px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;

  // ---- 测量行数，计算总高度 --------------------------------
  const tmpCtx = document.createElement('canvas').getContext('2d');
  tmpCtx.font = FONT_SM;
  const beforeLines   = wrapText(tmpCtx, before,   TW);
  const afterLines    = wrapText(tmpCtx, after,    TW);
  tmpCtx.font = FONT_LG;
  const selectedLines = wrapText(tmpCtx, selected, SEL_TW);

  let totalH = PV;
  if (beforeLines.length)  totalH += beforeLines.length  * LH_SM + GAP;
  totalH                          += selectedLines.length * LH_LG + GAP;
  if (afterLines.length)   totalH += afterLines.length   * LH_SM + GAP;
  totalH += 1 + GAP;        // 分隔线
  totalH += FOOTER_H + PV;  // footer + 底部 padding

  // ---- 创建正式 canvas ------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // ---- 背景 -----------------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);

  // y 始终指向"当前行顶部"，绘制时 baseline = y + font-size
  let y = PV;

  // ---- 上文 -----------------------------------------------
  if (beforeLines.length) {
    ctx.fillStyle = '#999999';
    ctx.font = FONT_SM;
    for (const line of beforeLines) {
      ctx.fillText(line, PH, y + 14);
      y += LH_SM;
    }
    y += GAP;
  }

  // ---- 选中文字 + 左侧 accent bar -------------------------
  const barStartY = y;
  const textX = PH + BAR_W + BAR_GAP;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = FONT_LG;
  for (const line of selectedLines) {
    ctx.fillText(line, textX, y + 20);
    y += LH_LG;
  }
  ctx.fillStyle = '#4F7EFF';
  ctx.fillRect(PH, barStartY, BAR_W, y - barStartY);
  y += GAP;

  // ---- 下文 -----------------------------------------------
  if (afterLines.length) {
    ctx.fillStyle = '#999999';
    ctx.font = FONT_SM;
    for (const line of afterLines) {
      ctx.fillText(line, PH, y + 14);
      y += LH_SM;
    }
    y += GAP;
  }

  // ---- 分隔线 ---------------------------------------------
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PH, y + 0.5);
  ctx.lineTo(W - PH, y + 0.5);
  ctx.stroke();
  y += 1 + GAP;

  // ---- Footer 左侧：标题 + 提示语 -------------------------
  const qrX = W - PH - QR_SIZE;
  const maxTitleW = qrX - PH - 12;

  ctx.font = FONT_TTL;
  let shortTitle = title;
  if (ctx.measureText(shortTitle).width > maxTitleW) {
    while (shortTitle.length > 0 && ctx.measureText(shortTitle + '…').width > maxTitleW) {
      shortTitle = shortTitle.slice(0, -1);
    }
    shortTitle += '…';
  }
  ctx.fillStyle = '#333333';
  ctx.fillText(shortTitle, PH, y + 18);

  ctx.font = FONT_SUB;
  ctx.fillStyle = '#999999';
  ctx.fillText('长按识别二维码查看原文', PH, y + 18 + 24);

  // ---- Footer 右侧：二维码 --------------------------------
  const qrY = y + (FOOTER_H - QR_SIZE) / 2;
  try {
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=${QR_SIZE * 2}x${QR_SIZE * 2}&margin=0`;
    const qrImg = await loadImage(qrSrc);
    ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);
  } catch (err) {
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(qrX, qrY, QR_SIZE, QR_SIZE);
    ctx.fillStyle = '#cccccc';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QR Code', qrX + QR_SIZE / 2, qrY + QR_SIZE / 2 + 4);
    ctx.textAlign = 'left';
    console.warn('[划词卡片] 二维码加载失败：', err.message);
  }

  return canvas;
}

// =====================================================================
// 剪贴板
// =====================================================================

/**
 * 将 canvas 内容写入系统剪贴板（PNG 格式）
 */
async function copyCanvasToClipboard(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('toBlob 返回空'));
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 'image/png');
  });
}

// =====================================================================
// UI 状态管理
// =====================================================================

let _loadingEl = null;
let _overlayEl = null;

/** 显示 loading toast */
function showLoading() {
  _loadingEl?.remove();
  const el = document.createElement('div');
  el.id = 'huaci-loading';
  el.textContent = '⏳ 正在生成卡片...';
  document.body.appendChild(el);
  _loadingEl = el;
}

/** 移除 loading toast */
function removeLoading() {
  _loadingEl?.remove();
  _loadingEl = null;
}

/** 移除预览浮层 */
function removeOverlay() {
  _overlayEl?.remove();
  _overlayEl = null;
  document.removeEventListener('keydown', _onKeyDown);
}

/** ESC 键关闭浮层 */
function _onKeyDown(e) {
  if (e.key === 'Escape') removeOverlay();
}

/**
 * 显示卡片预览浮层
 * @param {HTMLCanvasElement} canvas - 已绘制好的 canvas
 * @param {boolean} initialCopied   - 是否已自动复制成功
 */
function showPreview(canvas, initialCopied) {
  removeOverlay();

  // ---- 遮罩层（点击空白关闭）----
  const overlay = document.createElement('div');
  overlay.id = 'huaci-overlay';
  overlay.addEventListener('click', removeOverlay);

  // ---- 卡片容器（阻止点击冒泡）----
  const container = document.createElement('div');
  container.id = 'huaci-container';
  container.addEventListener('click', (e) => e.stopPropagation());

  // ---- 状态提示 ----
  const msg = document.createElement('div');
  msg.id = 'huaci-msg';
  msg.textContent = initialCopied ? '✅ 已复制到剪贴板' : '⚠️ 自动复制失败，请点击下方按钮复制';

  // ---- 卡片图片 ----
  const img = document.createElement('img');
  img.id  = 'huaci-img';
  img.src = canvas.toDataURL('image/png');
  img.alt = '分享卡片预览';

  // ---- 按钮行 ----
  const btns = document.createElement('div');
  btns.id = 'huaci-btns';

  // 复制按钮
  const copyBtn = document.createElement('button');
  copyBtn.className   = 'huaci-btn huaci-btn-primary';
  copyBtn.textContent = '📋 再复制一次';
  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled    = true;
    copyBtn.textContent = '复制中...';
    try {
      await copyCanvasToClipboard(canvas);
      msg.textContent     = '✅ 已复制到剪贴板';
      copyBtn.textContent = '✅ 已复制';
      setTimeout(() => {
        copyBtn.textContent = '📋 再复制一次';
        copyBtn.disabled    = false;
      }, 1600);
    } catch (err) {
      msg.textContent     = '❌ 复制失败：' + err.message;
      copyBtn.textContent = '📋 再复制一次';
      copyBtn.disabled    = false;
    }
  });

  // 关闭按钮
  const closeBtn = document.createElement('button');
  closeBtn.className   = 'huaci-btn huaci-btn-ghost';
  closeBtn.textContent = '✕ 关闭';
  closeBtn.addEventListener('click', removeOverlay);

  btns.append(copyBtn, closeBtn);
  container.append(msg, img, btns);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // ESC 关闭
  document.addEventListener('keydown', _onKeyDown);

  _overlayEl = overlay;
}

// =====================================================================
// 监听 background.js 消息
// =====================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'generateCard') return;

  // 1. 立即显示 loading，清除旧的浮层
  showLoading();
  removeOverlay();

  // 2. 采集数据
  const sel       = getSelectionWithContext(100);
  const pageTitle = document.title;
  const pageUrl   = location.href;

  console.group('[划词卡片] 数据采集');
  console.log('📌 选中文字：',        sel?.selected || message.selectionText);
  console.log('⬅️  前文（约100字）：', sel?.before   || '（无）');
  console.log('➡️  后文（约100字）：', sel?.after    || '（无）');
  console.log('📄 页面标题：',         pageTitle);
  console.log('🔗 页面 URL：',         pageUrl);
  console.groupEnd();

  const data = {
    selected : sel?.selected || message.selectionText || '',
    before   : sel?.before   || '',
    after    : sel?.after    || '',
    title    : pageTitle,
    url      : pageUrl,
  };

  // 3. 绘制卡片（含异步二维码加载）
  drawCard(data)
    .then(async (canvas) => {
      removeLoading();
      console.log(`[划词卡片] ✅ 卡片绘制完成 ${canvas.width}×${canvas.height}px`);

      // 4. 尝试自动复制到剪贴板
      let copied = false;
      try {
        await copyCanvasToClipboard(canvas);
        copied = true;
        console.log('[划词卡片] ✅ 已复制到剪贴板');
      } catch (err) {
        console.warn('[划词卡片] ⚠️ 自动复制失败：', err.message);
      }

      // 5. 显示预览浮层
      showPreview(canvas, copied);
    })
    .catch((err) => {
      removeLoading();
      console.error('[划词卡片] ❌ 绘制失败：', err);
    });

  sendResponse({ status: 'ok' });
});
