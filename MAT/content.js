// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "createCard") {
    generateCard(message.selectedText, message.pageUrl, message.pageTitle);
  }
});

// ── 主函数：生成卡片 ──────────────────────────────────────────
async function generateCard(text, url, title) {
  const W = 640;
  const pad = 28;
  const qrSize = 60;          // 二维码缩小
  const bottomH = 44;         // 底部信息栏高度（URL + 品牌）
  const lineH = 32;
  const fontSize = 20;
  // 思源黑体（Source Han Sans）字体栈，系统安装后自动生效，否则回退 PingFang SC
  const textFont = `bold ${fontSize}px "Source Han Sans CN", "Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const uiFont = `11px "Source Han Sans CN", "Source Han Sans SC", "Noto Sans SC", "PingFang SC", sans-serif`;

  // 第一步：测量文字，计算行数，动态决定画布高度
  const tmpCtx = document.createElement("canvas").getContext("2d");
  tmpCtx.font = textFont;
  const textMaxW = W - pad * 2 - 48; // 文字占满卡片全宽
  const lines = wrapText(tmpCtx, text, textMaxW);
  const textBlockH = lines.length * lineH;
  // 动态高度：文字区 + 二维码区（qrSize） + 底部信息栏 + 间距
  const H = Math.max(300, pad + 52 + textBlockH + 20 + qrSize + 12 + bottomH + pad);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. 渐变背景（左上→右下）
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#667eea");
  grad.addColorStop(1, "#764ba2");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 2. 白色卡片（圆角）
  drawRoundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 16, "#ffffff");

  // 3. 高亮条（卡片顶部装饰）
  drawRoundRect(ctx, pad + 24, pad + 20, W - pad * 2 - 48, 5, 3, "#FDE68A");

  // 4. 正文 — 全宽左对齐
  ctx.fillStyle = "#1e293b";
  ctx.font = textFont;
  ctx.textAlign = "left";
  const textX = pad + 24;
  const textStartY = pad + 52;
  lines.forEach((line, i) => {
    ctx.fillText(line, textX, textStartY + i * lineH);
  });

  // 5. 分隔线
  const dividerY = textStartY + textBlockH + 14;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad + 20, dividerY);
  ctx.lineTo(W - pad - 20, dividerY);
  ctx.stroke();

  // 6. 来源 URL（分隔线下方左侧）
  const infoY = dividerY + 22;
  ctx.font = uiFont;
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "left";
  const shortUrl = url.length > 52 ? url.slice(0, 49) + "…" : url;
  ctx.fillText(shortUrl, pad + 20, infoY);

  // 7. 品牌文字（分隔线下方右侧，二维码左边）
  const qrX = W - pad - qrSize - 16;
  const qrY = dividerY + 8;
  ctx.font = uiFont;
  ctx.fillStyle = "#a5b4fc";
  ctx.textAlign = "right";
  ctx.fillText("划词卡片", qrX - 10, infoY);

  // 8. 二维码（右下角）
  await drawQRCode(ctx, url, qrX, qrY, qrSize);

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

function wrapText(ctx, text, maxWidth) {
  // 将文本拆分为 token：中文逐字、英文/数字按词（以空白分隔）
  const tokens = [];
  const re = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2014\u2018\u2019\u201c\u201d]|[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0];
    if (t.length === 1) {
      tokens.push(t); // 单个中文字符
    } else {
      // 英文段落：按空格拆成词，保留空格作为粘连符
      t.split(/(\s+)/).filter(Boolean).forEach(w => tokens.push(w));
    }
  }

  const lines = [];
  let current = "";
  for (const token of tokens) {
    // 新行开头跳过空白 token
    if (!current && /^\s+$/.test(token)) continue;
    const test = current + token;
    if (ctx.measureText(test).width > maxWidth && current.trim()) {
      lines.push(current.trimEnd());
      current = /^\s+$/.test(token) ? "" : token;
    } else {
      current = test;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
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
    color: "#fff", fontSize: "14px", fontFamily: '"Source Han Sans CN", "Noto Sans SC", "PingFang SC", sans-serif',
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    transition: "opacity 0.4s", opacity: "1"
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; }, 2000);
  setTimeout(() => toast.remove(), 2500);
}
