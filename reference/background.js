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
