// background.js - Service Worker
// 负责注册右键菜单，并在用户点击时通知 content script

// 插件安装或更新时，注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "generateCard",
    title: "✂️ 生成分享卡片",
    contexts: ["selection"], // 只在用户选中文字时显示
  });
  console.log("[划词卡片] 右键菜单注册成功");
});

// 用户点击右键菜单时触发
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "generateCard") return;

  // 向当前页面的 content script 发送消息
  chrome.tabs.sendMessage(tab.id, {
    action: "generateCard",
    selectionText: info.selectionText, // 右键菜单也能拿到选中文字，作为备用
  });
});
