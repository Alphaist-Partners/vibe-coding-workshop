/**
 * content.js — 划词卡片核心逻辑（参考实现）
 *
 * 流程：右键触发 → 获取选中文字+上下文 → Canvas 绘制卡片 → 复制到剪贴板 → 显示预览
 */

// ---------------------------------------------------------------------------
// 配置 — 学员可以通过对话修改这些参数来个性化卡片
// ---------------------------------------------------------------------------
const CONFIG = {
  card: {
    width: 720,
    padding: 48,
    bgColor: "#ffffff",
    accentColor: "#4F46E5",     // 引用竖线颜色
    accentWidth: 4,
  },
  highlight: {
    color: "#1a1a1a",
    fontSize: 20,
    fontWeight: "bold",
    lineHeight: 1.7,
  },
  context: {
    color: "#999999",
    fontSize: 14,
    lineHeight: 1.6,
    maxChars: 120,              // 上下文最大字符数
  },
  source: {
    titleColor: "#333333",
    titleSize: 14,
    hintColor: "#aaaaaa",
    hintSize: 11,
    qrSize: 80,
  },
  divider: {
    color: "#e5e5e5",
    marginY: 24,
  },
};

// ---------------------------------------------------------------------------
// 监听来自 background.js 的消息
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "generateCard") {
    handleGenerateCard();
  }
});

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function handleGenerateCard() {
  // 1. 获取选区信息
  const info = getSelectionInfo();
  if (!info) return;

  // 2. 显示 loading
  showLoading();

  try {
    // 3. 绘制 Canvas
    const canvas = await renderCard(info);

    // 4. 复制到剪贴板
    await copyCanvasToClipboard(canvas);

    // 5. 保存到历史记录
    await saveToHistory(info, canvas);

    // 6. 显示预览
    hideLoading();
    showPreview(canvas);
  } catch (err) {
    hideLoading();
    console.error("划词卡片生成失败:", err);
  }
}

// ---------------------------------------------------------------------------
// 获取选区信息
// ---------------------------------------------------------------------------
function getSelectionInfo() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const selectedText = selection.toString().trim();
  if (!selectedText) return null;

  // 获取上下文
  let contextBefore = "";
  let contextAfter = "";
  try {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const parentEl =
      container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    const fullText = parentEl.textContent || "";
    const startIdx = fullText.indexOf(selectedText);
    if (startIdx > 0) {
      contextBefore = fullText
        .substring(Math.max(0, startIdx - CONFIG.context.maxChars), startIdx)
        .trim();
      if (startIdx - CONFIG.context.maxChars > 0) contextBefore = "..." + contextBefore;
    }
    const endIdx = startIdx + selectedText.length;
    if (endIdx < fullText.length) {
      contextAfter = fullText
        .substring(endIdx, endIdx + CONFIG.context.maxChars)
        .trim();
      if (endIdx + CONFIG.context.maxChars < fullText.length) contextAfter += "...";
    }
  } catch (e) {
    // 上下文获取失败不影响核心功能
  }

  return {
    selectedText,
    contextBefore,
    contextAfter,
    pageTitle: document.title,
    pageUrl: location.href,
  };
}

// ---------------------------------------------------------------------------
// Canvas 绘制
// ---------------------------------------------------------------------------
async function renderCard(info) {
  const { width, padding, bgColor, accentColor, accentWidth } = CONFIG.card;
  const contentWidth = width - padding * 2 - accentWidth - 16; // 16 for accent gap

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // 先测量高度
  canvas.width = width;
  canvas.height = 2000; // 临时高度

  let y = padding;

  // -- 上文 --
  if (info.contextBefore) {
    const lines = wrapText(ctx, info.contextBefore, contentWidth, CONFIG.context.fontSize);
    y += lines.length * CONFIG.context.fontSize * CONFIG.context.lineHeight;
    y += 8;
  }

  // -- 高亮文字 --
  const hlLines = wrapText(ctx, info.selectedText, contentWidth, CONFIG.highlight.fontSize);
  y += hlLines.length * CONFIG.highlight.fontSize * CONFIG.highlight.lineHeight;
  y += 8;

  // -- 下文 --
  if (info.contextAfter) {
    const lines = wrapText(ctx, info.contextAfter, contentWidth, CONFIG.context.fontSize);
    y += lines.length * CONFIG.context.fontSize * CONFIG.context.lineHeight;
  }

  // -- 分隔线 --
  y += CONFIG.divider.marginY * 2 + 1;

  // -- 底部信息 --
  y += Math.max(CONFIG.source.qrSize, 40) + padding;

  // 设置真实高度
  canvas.height = y;

  // ========= 开始绘制 =========

  // 背景
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, canvas.height);

  let drawY = padding;
  const textX = padding + accentWidth + 16;

  // -- 上文 --
  if (info.contextBefore) {
    ctx.fillStyle = CONFIG.context.color;
    ctx.font = `${CONFIG.context.fontSize}px -apple-system, "Segoe UI", sans-serif`;
    const lines = wrapText(ctx, info.contextBefore, contentWidth, CONFIG.context.fontSize);
    for (const line of lines) {
      drawY += CONFIG.context.fontSize * CONFIG.context.lineHeight;
      ctx.fillText(line, textX, drawY);
    }
    drawY += 8;
  }

  // -- 引用竖线（与高亮文字齐高）--
  const accentStartY = drawY + 4;

  // -- 高亮文字 --
  ctx.fillStyle = CONFIG.highlight.color;
  ctx.font = `${CONFIG.highlight.fontWeight} ${CONFIG.highlight.fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const hlLinesArr = wrapText(ctx, info.selectedText, contentWidth, CONFIG.highlight.fontSize);
  for (const line of hlLinesArr) {
    drawY += CONFIG.highlight.fontSize * CONFIG.highlight.lineHeight;
    ctx.fillText(line, textX, drawY);
  }

  const accentEndY = drawY + 4;

  // 画引用竖线
  ctx.fillStyle = accentColor;
  ctx.fillRect(padding, accentStartY, accentWidth, accentEndY - accentStartY);

  drawY += 8;

  // -- 下文 --
  if (info.contextAfter) {
    ctx.fillStyle = CONFIG.context.color;
    ctx.font = `${CONFIG.context.fontSize}px -apple-system, "Segoe UI", sans-serif`;
    const lines = wrapText(ctx, info.contextAfter, contentWidth, CONFIG.context.fontSize);
    for (const line of lines) {
      drawY += CONFIG.context.fontSize * CONFIG.context.lineHeight;
      ctx.fillText(line, textX, drawY);
    }
  }

  // -- 分隔线 --
  drawY += CONFIG.divider.marginY;
  ctx.strokeStyle = CONFIG.divider.color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, drawY);
  ctx.lineTo(width - padding, drawY);
  ctx.stroke();
  drawY += CONFIG.divider.marginY;

  // -- 底部：左边文字，右边二维码 --
  const qrSize = CONFIG.source.qrSize;
  const sourceTextX = padding;
  const qrX = width - padding - qrSize;

  // 网站标题
  ctx.fillStyle = CONFIG.source.titleColor;
  ctx.font = `${CONFIG.source.titleSize}px -apple-system, "Segoe UI", sans-serif`;
  const titleMaxWidth = qrX - sourceTextX - 16;
  const truncatedTitle = truncateText(ctx, info.pageTitle, titleMaxWidth);
  ctx.fillText(truncatedTitle, sourceTextX, drawY + 16);

  // 提示文字
  ctx.fillStyle = CONFIG.source.hintColor;
  ctx.font = `${CONFIG.source.hintSize}px -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText("扫码查看原文", sourceTextX, drawY + 36);

  // 二维码
  try {
    const qrImg = await loadImage(
      `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(info.pageUrl)}&size=${qrSize}x${qrSize}`
    );
    ctx.drawImage(qrImg, qrX, drawY, qrSize, qrSize);
  } catch (e) {
    // 二维码加载失败，显示 URL 文字
    ctx.fillStyle = CONFIG.source.hintColor;
    ctx.font = `10px monospace`;
    const urlLines = wrapText(ctx, info.pageUrl, qrSize, 10);
    let urlY = drawY;
    for (const line of urlLines) {
      urlY += 12;
      ctx.fillText(line, qrX, urlY);
    }
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** Canvas 文字自动换行 */
function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const lines = [];
  let line = "";
  for (const char of text) {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 截断文字 */
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (ctx.measureText(truncated + "...").width > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

/** 加载图片 Promise */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// 剪贴板
// ---------------------------------------------------------------------------
async function copyCanvasToClipboard(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, "image/png");
  });
}

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------
async function saveToHistory(info, canvas) {
  // 存缩略图（JPEG + 缩小尺寸），原图太大会撑爆 storage
  const thumbCanvas = document.createElement("canvas");
  const scale = 360 / canvas.width;
  thumbCanvas.width = 360;
  thumbCanvas.height = canvas.height * scale;
  const thumbCtx = thumbCanvas.getContext("2d");
  thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const record = {
    id: Date.now(),
    text: info.selectedText.substring(0, 100),
    pageTitle: info.pageTitle,
    pageUrl: info.pageUrl,
    imageDataUrl: thumbCanvas.toDataURL("image/jpeg", 0.6),
    createdAt: new Date().toISOString(),
  };

  return new Promise((resolve) => {
    chrome.storage.local.get("history", (data) => {
      const history = data.history || [];
      history.unshift(record);
      // 最多保留 50 条
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ history }, resolve);
    });
  });
}

// ---------------------------------------------------------------------------
// UI：Loading 和 Preview
// ---------------------------------------------------------------------------
function showLoading() {
  removeOverlay();
  const el = document.createElement("div");
  el.id = "share-card-loading";
  el.innerHTML = `<div class="sc-loading-inner">⏳ 正在生成卡片...</div>`;
  document.body.appendChild(el);
}

function hideLoading() {
  const el = document.getElementById("share-card-loading");
  if (el) el.remove();
}

function showPreview(canvas) {
  removeOverlay();
  const overlay = document.createElement("div");
  overlay.id = "share-card-overlay";
  overlay.innerHTML = `
    <div class="sc-preview-container">
      <div class="sc-toast">✅ 已复制到剪贴板</div>
      <div class="sc-preview-img-wrap"></div>
      <div class="sc-preview-actions">
        <button class="sc-btn sc-btn-copy">📋 再复制一次</button>
        <button class="sc-btn sc-btn-close">✕ 关闭</button>
      </div>
    </div>
  `;
  const imgWrap = overlay.querySelector(".sc-preview-img-wrap");
  const img = new Image();
  img.src = canvas.toDataURL();
  imgWrap.appendChild(img);

  // 关闭
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".sc-btn-close")) {
      overlay.remove();
    }
  });

  // 再复制
  overlay.querySelector(".sc-btn-copy").addEventListener("click", async () => {
    await copyCanvasToClipboard(canvas);
    const toast = overlay.querySelector(".sc-toast");
    toast.textContent = "✅ 已复制！";
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 1500);
  });

  document.body.appendChild(overlay);
}

function removeOverlay() {
  document.getElementById("share-card-overlay")?.remove();
  document.getElementById("share-card-loading")?.remove();
}
