// content.js - Content Script
// 运行在用户当前页面，负责获取选中文字及上下文信息

/**
 * 获取选中文字及其上下文
 * @param {number} contextLength 前后各取多少字符，默认 100
 * @returns {{ selected: string, before: string, after: string } | null}
 */
function getSelectionWithContext(contextLength = 100) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selected = selection.toString().trim();
  if (!selected) return null;

  const range = selection.getRangeAt(0);

  // ---- 获取"前文"：从选区起点往前取 contextLength 个字符 ----
  const beforeRange = document.createRange();
  beforeRange.setStart(range.startContainer.parentNode || document.body, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeFull = beforeRange.toString();
  const before = beforeFull.slice(-contextLength).trim();

  // ---- 获取"后文"：从选区终点往后取 contextLength 个字符 ----
  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEndAfter(
    range.endContainer.parentNode || document.body.lastChild
  );
  const afterFull = afterRange.toString();
  const after = afterFull.slice(0, contextLength).trim();

  return { selected, before, after };
}

// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "generateCard") return;

  // 1. 获取选中文字 + 上下文
  const selectionData = getSelectionWithContext(100);

  // 2. 获取页面标题和 URL
  const pageTitle = document.title;
  const pageUrl = location.href;

  // 3. 打印到控制台，确认数据正确
  console.group("[划词卡片] 数据采集");
  if (selectionData) {
    console.log("📌 选中文字：", selectionData.selected);
    console.log("⬅️  前文（约100字）：", selectionData.before);
    console.log("➡️  后文（约100字）：", selectionData.after);
  } else {
    console.warn("⚠️ 未能从 selection 获取文字，使用 background 传入的备用值");
    console.log("📌 选中文字（备用）：", message.selectionText);
  }
  console.log("📄 页面标题：", pageTitle);
  console.log("🔗 页面 URL：", pageUrl);
  console.groupEnd();

  // 回复 background（预留，后续可传回数据）
  sendResponse({ status: "ok" });
});
