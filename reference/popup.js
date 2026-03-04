/**
 * popup.js — 弹窗逻辑：展示历史记录 & 统计
 */

document.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  document.getElementById("clearBtn").addEventListener("click", clearHistory);
});

function loadHistory() {
  chrome.storage.local.get("history", (data) => {
    const history = data.history || [];
    const listEl = document.getElementById("historyList");
    const countEl = document.getElementById("totalCount");

    countEl.textContent = history.length;

    if (history.length === 0) {
      listEl.innerHTML = `<p class="empty-hint">暂无记录，去网页上选中文字试试吧 ✨</p>`;
      return;
    }

    listEl.innerHTML = history
      .map(
        (item) => `
      <div class="history-item" data-id="${item.id}">
        <img class="history-thumb" src="${item.imageDataUrl}" alt="卡片缩略图">
        <div class="history-info">
          <div class="history-text">${escapeHtml(item.text)}</div>
          <div class="history-meta">${escapeHtml(item.pageTitle)} · ${formatDate(item.createdAt)}</div>
        </div>
        <button class="history-delete" title="删除">✕</button>
      </div>
    `
      )
      .join("");

    // 点击卡片复制
    listEl.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".history-delete")) return;
        const id = Number(el.dataset.id);
        const record = history.find((h) => h.id === id);
        if (record) copyImageFromDataUrl(record.imageDataUrl);
      });
    });

    // 删除按钮
    listEl.querySelectorAll(".history-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.closest(".history-item").dataset.id);
        deleteRecord(id);
      });
    });
  });
}

function deleteRecord(id) {
  chrome.storage.local.get("history", (data) => {
    const history = (data.history || []).filter((h) => h.id !== id);
    chrome.storage.local.set({ history }, loadHistory);
  });
}

function clearHistory() {
  if (!confirm("确定清空所有历史记录？")) return;
  chrome.storage.local.set({ history: [] }, loadHistory);
}

/** 从 dataURL 复制图片到剪贴板 */
async function copyImageFromDataUrl(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showCopyToast();
  } catch (err) {
    console.error("复制失败:", err);
  }
}

function showCopyToast() {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    background: #10b981; color: #fff; padding: 6px 16px; border-radius: 16px;
    font-size: 13px; z-index: 9999; animation: fadeIn 0.2s;
  `;
  toast.textContent = "✅ 已复制到剪贴板";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
