// background.js - Service Worker
// 负责创建右键菜单，并在用户点击时通知 content script

// 插件安装或更新时，创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "generateCard",
    title: "✂️ 生成分享卡片",
    contexts: ["selection"], // 仅在用户选中文字时显示
  });
  console.log("划词卡片插件已安装，右键菜单已创建");
});

// 监听右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "generateCard") {
    // 向当前页面的 content script 发送消息
    chrome.tabs.sendMessage(tab.id, {
      action: "showCard",
      selectedText: info.selectionText,
    });
  }
});
