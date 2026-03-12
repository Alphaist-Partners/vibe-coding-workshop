const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const clearBtn = document.getElementById("clearBtn");

// 加载历史记录
chrome.storage.local.get({ history: [] }, ({ history }) => {
  if (history.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  history.forEach((item) => grid.appendChild(createItem(item)));
});

// 清空历史
clearBtn.addEventListener("click", () => {
  if (confirm("确定清空所有历史记录？")) {
    chrome.storage.local.set({ history: [] }, () => {
      grid.innerHTML = "";
      empty.style.display = "block";
    });
  }
});

function createItem(item) {
  const div = document.createElement("div");
  div.className = "card-item";
  div.title = "点击重新复制";

  const img = document.createElement("img");
  img.src = item.dataUrl;

  const info = document.createElement("div");
  info.className = "card-info";
  info.innerHTML = `
    <div class="card-text">${escHtml(item.text)}</div>
    <div class="card-url">${escHtml(item.url)}</div>
    <div class="card-time">${formatTime(item.time)}</div>
  `;

  div.append(img, info);

  // 点击重新复制图片
  div.addEventListener("click", async () => {
    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      div.style.background = "#d1fae5";
      setTimeout(() => (div.style.background = ""), 600);
    } catch (e) {
      alert("复制失败：" + e.message);
    }
  });

  return div;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("zh-CN") + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
