// content.js - Content Script
// 注入到每个页面，监听来自 background.js 的消息，获取选中文字及上下文

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "showCard") {
    const info = getSelectionInfo();
    console.log("=== 划词卡片：获取到的信息 ===");
    console.log("📝 选中文字:", info.selectedText);
    console.log("⬅️  前文（约100字）:", info.contextBefore);
    console.log("➡️  后文（约100字）:", info.contextAfter);
    console.log("📄 页面标题:", info.pageTitle);
    console.log("🔗 页面URL:", info.pageUrl);
    console.log("================================");

    // 绘制卡片
    drawCard(info)
      .then((canvas) => {
        console.log("✅ 卡片绘制完成，尺寸:", canvas.width, "x", canvas.height);
        // 输出 data URL，可粘贴到浏览器地址栏预览图片
        const dataUrl = canvas.toDataURL("image/png");
        console.log("🖼️ 卡片 data URL（复制到地址栏可预览）:", dataUrl);
      })
      .catch((err) => {
        console.error("❌ 卡片绘制失败:", err);
      });
  }
});

// ─────────────────────────────────────────────
// 获取选中文字及上下文信息
// ─────────────────────────────────────────────

/**
 * 获取当前选中文字的完整信息：
 * - 选中的文字本身
 * - 选中文字前约 100 字的上下文
 * - 选中文字后约 100 字的上下文
 * - 页面标题
 * - 页面 URL
 */
function getSelectionInfo() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return {
      selectedText: "",
      contextBefore: "",
      contextAfter: "",
      pageTitle: document.title,
      pageUrl: location.href,
    };
  }

  const selectedText = selection.toString();
  const range = selection.getRangeAt(0);

  // 前文：从当前节点起始到选区开始
  const beforeRange = document.createRange();
  beforeRange.setStart(range.startContainer, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const contextBefore = beforeRange.toString().slice(-100);

  // 后文：从选区结束到当前节点末尾
  const afterRange = document.createRange();
  const endNode = range.endContainer;
  const endNodeLength =
    endNode.nodeType === Node.TEXT_NODE
      ? endNode.textContent.length
      : endNode.childNodes.length;
  afterRange.setStart(endNode, range.endOffset);
  afterRange.setEnd(endNode, endNodeLength);
  const contextAfter = afterRange.toString().slice(0, 100);

  return {
    selectedText,
    contextBefore,
    contextAfter,
    pageTitle: document.title,
    pageUrl: location.href,
  };
}

// ─────────────────────────────────────────────
// Canvas 卡片绘制
// ─────────────────────────────────────────────

/**
 * 主入口：绘制卡片，返回 Promise<HTMLCanvasElement>
 */
async function drawCard(info) {
  const { selectedText, contextBefore, contextAfter, pageTitle, pageUrl } = info;

  // ── 布局常量 ──────────────────────────────
  const CARD_W     = 720;
  const PAD_X      = 48;          // 左右内边距
  const PAD_Y      = 48;          // 上下内边距
  const CONTENT_W  = CARD_W - PAD_X * 2;

  const ACCENT_COLOR = "#4F6EF7"; // 引用竖线颜色（蓝色）
  const ACCENT_W     = 4;         // 竖线宽度
  const ACCENT_GAP   = 14;        // 竖线与文字的间距
  const QUOTE_X      = PAD_X + ACCENT_W + ACCENT_GAP; // 引用文字起始 x
  const QUOTE_W      = CONTENT_W - ACCENT_W - ACCENT_GAP;

  // ── 字体 ──────────────────────────────────
  const FONT_FAMILY = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
  const CTX_FONT    = `14px ${FONT_FAMILY}`;   // 上下文字体
  const SEL_FONT    = `bold 20px ${FONT_FAMILY}`; // 选中文字字体
  const TITLE_FONT  = `600 14px ${FONT_FAMILY}`;  // 底部标题字体
  const SUB_FONT    = `12px ${FONT_FAMILY}`;       // 底部副标题字体

  const CTX_LH = 22;  // 上下文行高
  const SEL_LH = 32;  // 选中文字行高

  // ── 间距 ──────────────────────────────────
  const GAP_SM  = 20;  // 小间距（上下文与选中文字之间）
  const GAP_LG  = 32;  // 大间距（内容与分隔线之间）
  const QR_SIZE = 80;  // 二维码尺寸
  const INFO_H  = QR_SIZE; // 底部信息栏高度（以二维码高度为准）

  // ── 用临时 Canvas 做文字测量 ───────────────
  const mc = document.createElement("canvas");
  mc.width = CARD_W;
  const mCtx = mc.getContext("2d");
  mCtx.textBaseline = "top";

  /**
   * 文字自动换行：逐字测量，超出 maxWidth 则换行
   * 同时处理文字中已有的 \n 换行符
   */
  function wrapText(text, font, maxWidth) {
    mCtx.font = font;
    const lines = [];
    const paragraphs = text.split("\n");

    for (const para of paragraphs) {
      if (para === "") {
        lines.push("");
        continue;
      }
      let cur = "";
      for (const ch of para) {
        const test = cur + ch;
        if (mCtx.measureText(test).width > maxWidth && cur !== "") {
          lines.push(cur);
          cur = ch;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  // ── 截断上下文（超出部分加省略号）─────────
  const before = contextBefore.length > 100
    ? "…" + contextBefore.slice(-100)
    : contextBefore;
  const after = contextAfter.length > 100
    ? contextAfter.slice(0, 100) + "…"
    : contextAfter;

  // ── 预计算所有文字行数 ──────────────────────
  const beforeLines   = before ? wrapText(before, CTX_FONT, CONTENT_W) : [];
  const selectedLines = wrapText(selectedText, SEL_FONT, QUOTE_W);
  const afterLines    = after  ? wrapText(after,  CTX_FONT, CONTENT_W) : [];

  const selectedBlockH = selectedLines.length * SEL_LH;

  // ── 计算卡片总高度 ─────────────────────────
  let totalH = PAD_Y;
  if (beforeLines.length > 0) totalH += beforeLines.length * CTX_LH + GAP_SM;
  totalH += selectedBlockH;
  if (afterLines.length > 0)  totalH += GAP_SM + afterLines.length * CTX_LH;
  totalH += GAP_LG + 1 + GAP_LG + INFO_H + PAD_Y; // 分隔线 + 底部信息栏

  // ── 创建正式 Canvas ────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width  = CARD_W;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";

  // ── 背景 ───────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, totalH);

  let y = PAD_Y;

  // ── 上文 ───────────────────────────────────
  if (beforeLines.length > 0) {
    ctx.font      = CTX_FONT;
    ctx.fillStyle = "#999999";
    for (const line of beforeLines) {
      ctx.fillText(line, PAD_X, y);
      y += CTX_LH;
    }
    y += GAP_SM;
  }

  // ── 引用竖线 ───────────────────────────────
  ctx.fillStyle = ACCENT_COLOR;
  ctx.fillRect(PAD_X, y, ACCENT_W, selectedBlockH);

  // ── 选中文字 ───────────────────────────────
  ctx.font      = SEL_FONT;
  ctx.fillStyle = "#1a1a1a";
  // 文字在行高内垂直居中：(SEL_LH - 20px字号) / 2 = 6px 偏移
  const SEL_OFFSET = Math.floor((SEL_LH - 20) / 2);
  for (const line of selectedLines) {
    ctx.fillText(line, QUOTE_X, y + SEL_OFFSET);
    y += SEL_LH;
  }

  // ── 下文 ───────────────────────────────────
  if (afterLines.length > 0) {
    y += GAP_SM;
    ctx.font      = CTX_FONT;
    ctx.fillStyle = "#999999";
    for (const line of afterLines) {
      ctx.fillText(line, PAD_X, y);
      y += CTX_LH;
    }
  }

  // ── 分隔线 ─────────────────────────────────
  y += GAP_LG;
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(PAD_X, y, CONTENT_W, 1);
  y += 1 + GAP_LG;

  // ── 底部信息栏 ─────────────────────────────
  // 左侧：网站标题 + 副标题
  const titleMaxW = CONTENT_W - QR_SIZE - 24;

  // 截断超长标题
  ctx.font = TITLE_FONT;
  let title = pageTitle;
  if (ctx.measureText(title).width > titleMaxW) {
    while (ctx.measureText(title + "…").width > titleMaxW && title.length > 0) {
      title = title.slice(0, -1);
    }
    title += "…";
  }

  ctx.fillStyle = "#333333";
  ctx.fillText(title, PAD_X, y);

  ctx.font      = SUB_FONT;
  ctx.fillStyle = "#999999";
  ctx.fillText("长按识别二维码查看原文", PAD_X, y + 14 + 8);

  // 右侧：二维码
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(pageUrl)}&size=80x80`;
    const qrImg = await loadImage(qrUrl);
    // 二维码在底部信息栏内垂直居中
    const qrY = y + Math.floor((INFO_H - QR_SIZE) / 2);
    ctx.drawImage(qrImg, CARD_W - PAD_X - QR_SIZE, qrY, QR_SIZE, QR_SIZE);
  } catch (e) {
    console.warn("⚠️ 二维码加载失败:", e);
    // 失败时画一个灰色占位框
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(CARD_W - PAD_X - QR_SIZE, y, QR_SIZE, QR_SIZE);
    ctx.font      = `10px ${FONT_FAMILY}`;
    ctx.fillStyle = "#999";
    ctx.fillText("QR 加载失败", CARD_W - PAD_X - QR_SIZE + 8, y + QR_SIZE / 2 - 5);
  }

  return canvas;
}

/**
 * 将 URL 加载为 HTMLImageElement（Promise 包装）
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}
