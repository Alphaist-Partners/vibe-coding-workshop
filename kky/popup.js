// popup.js - 历史记录查看器

// ── DOM 元素 ──────────────────────────────────────────────
const listEl  = document.getElementById("js-list");
const emptyEl = document.getElementById("js-empty");
const countEl = document.getElementById("js-count");

// ── 工具函数 ──────────────────────────────────────────────

/** 从 storage 读取历史记录 */
function loadHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get("hk_history", ({ hk_history = [] }) => {
      resolve(hk_history);
    });
  });
}

/** 删除指定 id 的记录 */
function deleteRecord(id) {
  return new Promise((resolve) => {
    chrome.storage.local.get("hk_history", ({ hk_history = [] }) => {
      const updated = hk_history.filter((r) => r.id !== id);
      chrome.storage.local.set({ hk_history: updated }, resolve);
    });
  });
}

/** 把 dataUrl 转换为 Blob，再写入剪贴板 */
async function copyImageToClipboard(dataUrl) {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  // 从 data:image/png;base64,... 解析 MIME
  const mime = dataUrl.split(";")[0].split(":")[1] || "image/png";
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
}

/** 把 ISO 时间字符串转成「X 分钟前」等相对时间 */
function formatTime(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return "刚刚";
  if (mins < 60)  return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days  = Math.floor(hours / 24);
  if (days < 30)  return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

// ── 渲染 ──────────────────────────────────────────────────

async function render() {
  const history = await loadHistory();

  // 更新统计
  countEl.textContent = `共生成 ${history.length} 张`;

  if (history.length === 0) {
    listEl.style.display  = "none";
    emptyEl.style.display = "flex";
    return;
  }

  listEl.style.display  = "block";
  emptyEl.style.display = "none";
  listEl.innerHTML = "";

  history.forEach((record) => {
    listEl.appendChild(createItem(record));
  });
}

/** 创建单条历史记录的 DOM 元素 */
function createItem(record) {
  const item = document.createElement("div");
  item.className = "item";

  /* 缩略图 */
  const thumb = document.createElement("img");
  thumb.className = "item-thumb";
  thumb.src = record.imageDataUrl;
  thumb.alt = "卡片缩略图";
  // 图片加载失败时显示占位背景
  thumb.onerror = () => {
    thumb.style.background = "#f0f0f2";
    thumb.removeAttribute("src");
  };

  /* 右侧内容区 */
  const content = document.createElement("div");
  content.className = "item-content";

  // 选中文字（2行截断）
  const text = document.createElement("div");
  text.className   = "item-text";
  text.textContent = record.text || "（无文字）";

  // 来源网站标题
  const source = document.createElement("div");
  source.className   = "item-source";
  source.textContent = record.pageTitle || record.pageUrl || "未知来源";

  // 底部 meta 行：时间 + 操作按钮
  const meta = document.createElement("div");
  meta.className = "item-meta";

  const time = document.createElement("span");
  time.className   = "item-time";
  time.textContent = formatTime(record.createdAt);
  time.title       = new Date(record.createdAt).toLocaleString("zh-CN");

  const actions = document.createElement("div");
  actions.className = "item-actions";

  /* 📋 复制按钮 */
  const copyBtn = document.createElement("button");
  copyBtn.className = "icon-btn";
  copyBtn.title     = "复制卡片到剪贴板";
  copyBtn.textContent = "📋";
  copyBtn.addEventListener("click", async () => {
    try {
      await copyImageToClipboard(record.imageDataUrl);
      copyBtn.textContent = "✅";
    } catch {
      copyBtn.textContent = "❌";
    }
    setTimeout(() => {
      copyBtn.textContent = "📋";
    }, 1800);
  });

  /* 🗑️ 删除按钮 */
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.title     = "删除这条记录";
  deleteBtn.textContent = "🗑️";
  deleteBtn.addEventListener("click", async () => {
    // 先播放退场动画，动画结束后再重新渲染
    item.classList.add("item-removing");
    await deleteRecord(record.id);
    setTimeout(() => render(), 200);
  });

  actions.appendChild(copyBtn);
  actions.appendChild(deleteBtn);

  meta.appendChild(time);
  meta.appendChild(actions);

  content.appendChild(text);
  content.appendChild(source);
  content.appendChild(meta);

  item.appendChild(thumb);
  item.appendChild(content);

  return item;
}

// ── 初始化 ────────────────────────────────────────────────
render();
