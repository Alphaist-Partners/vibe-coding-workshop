'use strict';
/* global chrome */

// Card dimensions (16:9)
const CARD_W = 960;
const CARD_H = 540;

// 4 purple-based themes
const THEMES = [
  {
    id: 0,
    name: '深邃',
    light: false,
    grad: ['#0d0015', '#200040', '#2e0060'],
    accent: '#c084fc',
    text: '#f0e6ff',
    sub: 'rgba(216,180,254,0.7)',
    titleColor: 'rgba(216,180,254,0.4)',
    barBg: 'rgba(0,0,0,0.42)',
    barSep: 'rgba(255,255,255,0.07)',
    quoteFill: 'rgba(255,255,255,0.04)',
    glowColor: '#c084fc',
  },
  {
    id: 1,
    name: '紫韵',
    light: false,
    grad: ['#1e0040', '#4c1d95', '#7c3aed'],
    accent: '#fde68a',
    text: '#ffffff',
    sub: 'rgba(253,230,138,0.75)',
    titleColor: 'rgba(253,230,138,0.45)',
    barBg: 'rgba(0,0,0,0.35)',
    barSep: 'rgba(255,255,255,0.08)',
    quoteFill: 'rgba(255,255,255,0.04)',
    glowColor: '#fde68a',
  },
  {
    id: 2,
    name: '薰衣草',
    light: false,
    grad: ['#3b0764', '#6d28d9', '#a78bfa'],
    accent: '#ffffff',
    text: '#ffffff',
    sub: 'rgba(255,255,255,0.7)',
    titleColor: 'rgba(255,255,255,0.45)',
    barBg: 'rgba(0,0,0,0.28)',
    barSep: 'rgba(255,255,255,0.1)',
    quoteFill: 'rgba(255,255,255,0.05)',
    glowColor: '#e9d5ff',
  },
  {
    id: 3,
    name: '雅白',
    light: true,
    grad: ['#ffffff', '#f5f0ff', '#ede9fe'],
    accent: '#7c3aed',
    text: '#1e0040',
    sub: 'rgba(109,40,217,0.7)',
    titleColor: 'rgba(109,40,217,0.45)',
    barBg: 'rgba(109,40,217,0.07)',
    barSep: 'rgba(109,40,217,0.12)',
    quoteFill: 'rgba(109,40,217,0.05)',
    glowColor: '#7c3aed',
  },
];

class CardRenderer {
  // ─── Public API ─────────────────────────────────────────────────────────────

  async render(text, url, title, themeIdx = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    const theme = THEMES[themeIdx % THEMES.length];

    // Fetch QR in parallel while drawing
    const qrPromise = this._fetchQRImage(url);

    this._drawBackground(ctx, theme);
    this._drawDecorations(ctx, theme);
    this._drawText(ctx, text, theme);

    const qrImg = await qrPromise;
    this._drawSourceBar(ctx, url, title, theme, qrImg);

    return canvas;
  }

  async copyToClipboard(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve(true);
        } catch (e) { reject(e); }
      }, 'image/png');
    });
  }

  getThumbnailDataURL(canvas) {
    const thumb = document.createElement('canvas');
    thumb.width = 360;
    thumb.height = 202;
    thumb.getContext('2d').drawImage(canvas, 0, 0, 360, 202);
    return thumb.toDataURL('image/jpeg', 0.75);
  }

  getDataURL(canvas) {
    return canvas.toDataURL('image/png');
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────────

  _drawBackground(ctx, theme) {
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    theme.grad.forEach((c, i) => g.addColorStop(i / (theme.grad.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Radial glow — accent color, top-left area
    const r = ctx.createRadialGradient(
      CARD_W * 0.15, CARD_H * 0.2, 0,
      CARD_W * 0.15, CARD_H * 0.2, CARD_W * 0.48
    );
    r.addColorStop(0, theme.glowColor + (theme.light ? '18' : '22'));
    r.addColorStop(1, 'transparent');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }

  _drawDecorations(ctx, theme) {
    // Large decorative quote mark
    ctx.save();
    ctx.font = 'bold 240px Georgia, "Times New Roman", serif';
    ctx.fillStyle = theme.quoteFill;
    ctx.fillText('\u201C', -15, 230);
    ctx.restore();

    // Vertical accent bar
    ctx.save();
    ctx.fillStyle = theme.accent;
    this._roundRect(ctx, 54, 108, 4, 274, 2);
    ctx.fill();
    ctx.restore();
  }

  _drawText(ctx, text, theme) {
    const PAD_L = 78, PAD_R = 190;
    const maxW = CARD_W - PAD_L - PAD_R;
    const textAreaTop = 108, textAreaH = 314;

    ctx.save();
    ctx.fillStyle = theme.text;

    let fontSize = 44;
    let lines;
    while (fontSize >= 16) {
      ctx.font = `400 ${fontSize}px "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif`;
      lines = this._wrapText(ctx, text, maxW);
      if (lines.length * fontSize * 1.65 <= textAreaH) break;
      fontSize -= 2;
    }

    const lineH = fontSize * 1.65;
    const maxLines = Math.floor(textAreaH / lineH);
    const display = lines.slice(0, maxLines);

    if (lines.length > maxLines) {
      let last = display[display.length - 1];
      while (last.length > 0 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      display[display.length - 1] = last + '…';
    }

    const totalH = display.length * lineH;
    const startY = textAreaTop + (textAreaH - totalH) / 2 + fontSize;
    display.forEach((line, i) => ctx.fillText(line, PAD_L, startY + i * lineH));
    ctx.restore();
  }

  _wrapText(ctx, text, maxW) {
    const lines = [];
    for (const para of text.split('\n')) {
      if (!para.trim()) { lines.push(''); continue; }
      let cur = '';
      for (const ch of para) {
        if (ctx.measureText(cur + ch).width > maxW) {
          if (cur) lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines.length ? lines : [''];
  }

  _drawSourceBar(ctx, url, title, theme, qrImg) {
    const barH = 82, barY = CARD_H - barH;
    ctx.save();

    ctx.fillStyle = theme.barBg;
    ctx.fillRect(0, barY, CARD_W, barH);

    ctx.strokeStyle = theme.barSep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barY);
    ctx.lineTo(CARD_W, barY);
    ctx.stroke();

    let domain = url;
    try { domain = new URL(url).hostname; } catch (_) {}

    ctx.font = `500 15px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = theme.sub;
    ctx.fillText(domain, 78, barY + 30);

    const maxTitleW = CARD_W - 210;
    ctx.font = `400 12px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = theme.titleColor;
    let t = title || '';
    while (t.length && ctx.measureText(t).width > maxTitleW) t = t.slice(0, -1);
    if (t !== (title || '')) t += '…';
    ctx.fillText(t, 78, barY + 54);

    // QR box
    const qrSize = 62, qrX = CARD_W - qrSize - 16, qrY = barY + (barH - qrSize) / 2;
    ctx.fillStyle = '#ffffff';
    this._roundRect(ctx, qrX, qrY, qrSize, qrSize, 4);
    ctx.fill();

    // Border on light theme
    if (theme.light) {
      ctx.strokeStyle = 'rgba(109,40,217,0.2)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, qrX, qrY, qrSize, qrSize, 4);
      ctx.stroke();
    }

    if (qrImg) {
      ctx.drawImage(qrImg, qrX + 2, qrY + 2, qrSize - 4, qrSize - 4);
    } else {
      this._drawQRPlaceholder(ctx, qrX + 4, qrY + 4, qrSize - 8);
    }

    ctx.restore();
  }

  _drawQRPlaceholder(ctx, x, y, size) {
    const cell = size / 10;
    ctx.fillStyle = '#5b21b6';
    const p = [
      [1, 1, 1, 1, 1, 1, 1, 0, 1, 0],
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 1, 1, 0, 1, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1, 0, 1, 1],
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
      [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
    ];
    p.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v) ctx.fillRect(x + c * cell, y + r * cell, cell - 0.5, cell - 0.5);
      })
    );
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }
  }

  async _fetchQRImage(url) {
    try {
      const { dataUrl } = await chrome.runtime.sendMessage({ action: 'fetchQR', url });
      if (!dataUrl) return null;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      return img;
    } catch {
      return null;
    }
  }
}

window.CardRenderer = CardRenderer;
window.CARD_THEMES = THEMES;
