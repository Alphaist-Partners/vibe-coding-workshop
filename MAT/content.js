// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "createCard") {
    generateCard(message.selectedText, message.pageUrl, message.pageTitle);
  }
});

// ── 主函数：生成卡片 ──────────────────────────────────────────
async function generateCard(text, url, title) {
  const canvas = document.createElement("canvas");
  const W = 640, H = 380;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. 深色背景
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, W, H);

  // 2. 白色卡片（圆角）
  const pad = 28;
  drawRoundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 16, "#ffffff");

  // 3. 高亮条
  drawRoundRect(ctx, pad + 24, pad + 22, W - pad * 2 - 48, 6, 3, "#FDE68A");

  // 4. 正文（自动换行，最多5行）
  ctx.fillStyle = "#1e293b";
  ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = "center";
  const maxW = W - pad * 2 - 120; // 留出二维码宽度
  const lines = wrapText(ctx, text, maxW, 5);
  const lineH = 30;
  const textY = H / 2 - (lines.length * lineH) / 2 + 10;
  lines.forEach((line, i) => {
    ctx.fillText(line, (W - 90) / 2 + pad, textY + i * lineH);
  });

  // 5. 来源 URL（底部左下角）
  ctx.font = '11px "PingFang SC", monospace';
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "left";
  const shortUrl = url.length > 55 ? url.slice(0, 52) + "…" : url;
  ctx.fillText(shortUrl, pad + 20, H - pad - 14);

  // 6. 品牌文字（右下角）
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillStyle = "#cbd5e1";
  ctx.textAlign = "right";
  ctx.fillText("划词卡片", W - pad - 16, H - pad - 14);

  // 7. 二维码（右侧中间）
  await drawQRCode(ctx, url, W - pad - 100, pad + 36, 84);

  // 8. 复制到剪贴板 + 保存历史
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      showToast("✅ 卡片已复制到剪贴板！");
      saveHistory({ text, url, title, dataUrl: canvas.toDataURL(), time: Date.now() });
    } catch (e) {
      showToast("❌ 复制失败：" + e.message, true);
    }
  });
}

// ── 工具函数 ──────────────────────────────────────────────────

function drawRoundRect(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  // 支持中英文混合：按空格分英文词，中文按字符拆
  const segments = text.split(/(\s+)/);
  let current = "";
  for (const seg of segments) {
    const test = current + seg;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current.trim());
      current = seg;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current.trim() && lines.length < maxLines) {
    lines.push(current.trim());
  }
  return lines;
}

async function drawQRCode(ctx, url, x, y, size) {
  try {
    // 使用 qrcodejs（lib/qrcode.min.js）：DOM 方式生成后绘入 canvas
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(container);
    new QRCode(container, {
      text: url, width: size, height: size,
      colorDark: "#1e293b", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    // qrcodejs 会在 container 内生成 <canvas> 或 <img>
    const el = container.querySelector("canvas") || container.querySelector("img");
    if (el) ctx.drawImage(el, x, y, size, size);
    container.remove();
  } catch (e) {
    ctx.font = "10px monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    ctx.fillText("[QR]", x + size / 2, y + size / 2);
  }
}

function saveHistory(item) {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    history.unshift(item);
    if (history.length > 30) history = history.slice(0, 30);
    chrome.storage.local.set({ history });
  });
}

function showToast(msg, isError = false) {
  const toast = document.createElement("div");
  Object.assign(toast.style, {
    position: "fixed", top: "24px", right: "24px", zIndex: "2147483647",
    padding: "12px 20px", borderRadius: "10px",
    background: isError ? "#ef4444" : "#1e293b",
    color: "#fff", fontSize: "14px", fontFamily: "PingFang SC, sans-serif",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    transition: "opacity 0.4s", opacity: "1"
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; }, 2000);
  setTimeout(() => toast.remove(), 2500);
}
