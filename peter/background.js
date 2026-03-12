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
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "generateCard") return;

  const payload = {
    action: "generateCard",
    selectionText: info.selectionText,
  };

  try {
    // 先尝试直接发消息（正常情况：页面在插件加载后打开，content script 已注入）
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    // 发消息失败，说明 content script 尚未注入
    // 常见原因：页面在插件安装/更新前就已打开
    console.warn("[划词卡片] content script 未就绪，尝试动态注入...");
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
      // 注入完成后再次发消息
      await chrome.tabs.sendMessage(tab.id, payload);
    } catch (injectErr) {
      // chrome:// 等受保护页面无法注入，静默处理
      console.error("[划词卡片] 注入失败（可能是受保护页面）：", injectErr.message);
    }
  }
});
