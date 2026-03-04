/**
 * background.js — Service Worker
 * 处理右键菜单
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "generate-share-card",
    title: "✂️ 生成分享卡片",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "generate-share-card" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "generateCard",
      selectionText: info.selectionText,
    });
  }
});

// ---------------------------------------------------------------------------
// 代理图片请求 — Service Worker 不受页面 CSP 限制
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "fetchImage" && message.url) {
    fetch(message.url)
      .then((r) => r.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ dataUrl: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch((e) => sendResponse({ error: e.message }));
    return true; // 保持 sendResponse 通道开放
  }
});
