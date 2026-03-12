// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveContent') {
    // 获取当前页面信息
    const pageInfo = {
      text: request.text,
      url: window.location.href,
      title: document.title
    };
    sendResponse(pageInfo);
  }
});
