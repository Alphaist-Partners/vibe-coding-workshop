// content.js - Content Script

// =====================================================================
// 工具函数
// =====================================================================

/**
 * 自动换行 —— 支持中英文混排
 * 逐字符检测宽度，保证 CJK 和拉丁字母都能正确折行
 *
 * @param {CanvasRenderingContext2D} ctx  - 已设置好 font 的 canvas context
 * @param {string}  text     - 待换行文字
 * @param {number}  maxWidth - 最大宽度（像素）
 * @returns {string[]}  每行文字数组
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
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败: ' + src));
    img.src = src;
  });
}

/**
 * 获取用户选中文字 + 前后各 contextLength 字的上下文
 *
 * 策略：向上找最近的块级元素，从其 textContent 里截取上下文，
 * 避免跨节点拼接带来的乱序问题。
 */
function getSelectionWithContext(contextLength = 100) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const selected = selection.toString().trim();
  if (!selected) return null;

  const range = selection.getRangeAt(0);

  // 找到选区的公共祖先，向上找块级元素作为上下文容器
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
 * 绘制分享卡片，返回 HTMLCanvasElement（在内存中，不插入页面）
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
  const W       = 720;    // 卡片宽度
  const PH      = 40;     // 水平内边距
  const PV      = 40;     // 垂直内边距
  const TW      = W - PH * 2;       // 正文区域宽度
  const LH_SM   = 22;     // 小字行高（14px 字体）
  const LH_LG   = 32;     // 大字行高（20px 字体）
  const GAP     = 16;     // 段落间距
  const BAR_W   = 4;      // 左侧 accent 竖线宽度
  const BAR_GAP = 12;     // 竖线与文字间距
  const SEL_TW  = TW - BAR_W - BAR_GAP;  // 选中文字可用宽度
  const FOOTER_H = 100;   // footer 区域高度
  const QR_SIZE  = 80;    // 二维码尺寸

  // ---- 字体定义 ----------------------------------------
  const FONT_SM  = `14px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_LG  = `bold 20px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_TTL = `600 14px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const FONT_SUB = `12px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;

  // ---- 用临时 canvas 测量行数，计算总高度 ----------------
  const tmpCtx = document.createElement('canvas').getContext('2d');

  tmpCtx.font = FONT_SM;
  const beforeLines   = wrapText(tmpCtx, before, TW);
  const afterLines    = wrapText(tmpCtx, after,  TW);

  tmpCtx.font = FONT_LG;
  const selectedLines = wrapText(tmpCtx, selected, SEL_TW);

  let totalH = PV;
  if (beforeLines.length)   totalH += beforeLines.length   * LH_SM + GAP;
  totalH                           += selectedLines.length  * LH_LG + GAP;
  if (afterLines.length)    totalH += afterLines.length    * LH_SM + GAP;
  totalH += 1 + GAP;       // 分隔线
  totalH += FOOTER_H + PV; // footer + 底部 padding

  // ---- 创建正式 canvas ------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // ---- 背景（纯白）----------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);

  // y 始终指向"当前文字行的顶部"
  // 画文字时 baseline = y + font-size，画完后 y += lineHeight
  let y = PV;

  // ---- 上文 -----------------------------------------------
  if (beforeLines.length) {
    ctx.fillStyle = '#999999';
    ctx.font = FONT_SM;
    for (const line of beforeLines) {
      ctx.fillText(line, PH, y + 14); // baseline = top + 14px
      y += LH_SM;
    }
    y += GAP;
  }

  // ---- 选中文字 + 左侧 accent bar -------------------------
  const barStartY = y;
  const textX     = PH + BAR_W + BAR_GAP;

  ctx.fillStyle = '#1a1a1a';
  ctx.font = FONT_LG;
  for (const line of selectedLines) {
    ctx.fillText(line, textX, y + 20); // baseline = top + 20px
    y += LH_LG;
  }

  // 绘制左侧竖线（在文字绘制后再画，高度正好等于文字块高度）
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
  ctx.moveTo(PH, y + 0.5);   // +0.5 让 1px 线清晰
  ctx.lineTo(W - PH, y + 0.5);
  ctx.stroke();
  y += 1 + GAP;

  // ---- Footer：左侧文字 ------------------------------------
  const qrX = W - PH - QR_SIZE;
  const maxTitleW = qrX - PH - 12; // 标题最大宽度，留 12px 离二维码

  // 截断过长的标题
  ctx.font = FONT_TTL;
  let shortTitle = title;
  if (ctx.measureText(shortTitle).width > maxTitleW) {
    while (shortTitle.length > 0 && ctx.measureText(shortTitle + '…').width > maxTitleW) {
      shortTitle = shortTitle.slice(0, -1);
    }
    shortTitle += '…';
  }

  ctx.fillStyle = '#333333';
  ctx.font = FONT_TTL;
  ctx.fillText(shortTitle, PH, y + 18);

  ctx.fillStyle = '#999999';
  ctx.font = FONT_SUB;
  ctx.fillText('长按识别二维码查看原文', PH, y + 18 + 22);

  // ---- Footer：右侧二维码 ----------------------------------
  const qrY = y + (FOOTER_H - QR_SIZE) / 2;
  try {
    // 请求 2× 尺寸再缩放，让二维码在高分屏上更清晰
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=${QR_SIZE * 2}x${QR_SIZE * 2}&margin=0`;
    const qrImg = await loadImage(qrSrc);
    ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);
  } catch (err) {
    // 加载失败时绘制占位框
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
// 监听 background.js 发来的消息
// =====================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'generateCard') return;

  // 1. 采集数据
  const sel       = getSelectionWithContext(100);
  const pageTitle = document.title;
  const pageUrl   = location.href;

  console.group('[划词卡片] 数据采集');
  console.log('📌 选中文字：', sel?.selected || message.selectionText);
  console.log('⬅️  前文（约100字）：', sel?.before || '（无）');
  console.log('➡️  后文（约100字）：', sel?.after  || '（无）');
  console.log('📄 页面标题：', pageTitle);
  console.log('🔗 页面 URL：', pageUrl);
  console.groupEnd();

  const data = {
    selected : sel?.selected || message.selectionText || '',
    before   : sel?.before  || '',
    after    : sel?.after   || '',
    title    : pageTitle,
    url      : pageUrl,
  };

  // 2. 绘制卡片（异步）
  drawCard(data)
    .then(canvas => {
      console.log(`[划词卡片] ✅ 卡片绘制完成 ${canvas.width}×${canvas.height}px`);

      // ---- 调试预览：将 canvas 固定在页面右上角，点击关闭 ----
      canvas.title = '点击关闭';
      canvas.style.cssText = [
        'position:fixed',
        'top:20px',
        'right:20px',
        'z-index:2147483647',
        'cursor:pointer',
        'box-shadow:0 8px 32px rgba(0,0,0,0.2)',
        'border-radius:12px',
        'transform:scale(0.55)',
        'transform-origin:top right',
      ].join(';');
      canvas.addEventListener('click', () => canvas.remove());
      document.body.appendChild(canvas);
    })
    .catch(err => console.error('[划词卡片] ❌ 绘制失败：', err));

  sendResponse({ status: 'ok' });
});
