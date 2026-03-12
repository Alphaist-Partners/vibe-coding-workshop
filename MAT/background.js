// 安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "createCard",
    title: "✂️ 生成划词卡片",
    contexts: ["selection"]
  });
});

// 右键菜单点击 → 发消息给 content script
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "createCard") {
    chrome.tabs.sendMessage(tab.id, {
      action: "createCard",
      selectedText: info.selectionText,
      pageUrl: info.pageUrl,
      pageTitle: tab.title
    });
  }
});
