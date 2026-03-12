// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  // 文字选区菜单
  chrome.contextMenus.create({
    id: "saveText",
    title: "保存到灵感库",
    contexts: ["selection"]
  });

  // 图片菜单
  chrome.contextMenus.create({
    id: "saveImage",
    title: "保存图片链接到灵感库",
    contexts: ["image"]
  });

  // 页面菜单（保存当前页面链接）
  chrome.contextMenus.create({
    id: "savePage",
    title: "保存当前页面到灵感库",
    contexts: ["page"]
  });

  // 链接菜单
  chrome.contextMenus.create({
    id: "saveLink",
    title: "保存链接到灵感库",
    contexts: ["link"]
  });
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  let textToSave = '';
  let itemType = 'text';

  switch (info.menuItemId) {
    case "saveText":
      textToSave = info.selectionText;
      itemType = 'text';
      break;
    case "saveImage":
      textToSave = `[图片] ${info.srcUrl}`;
      itemType = 'image';
      break;
    case "savePage":
      textToSave = `[页面] ${tab.title}`;
      itemType = 'page';
      break;
    case "saveLink":
      textToSave = `[链接] ${info.linkUrl}`;
      itemType = 'link';
      break;
  }

  // 发送消息到 content script 获取页面信息
  chrome.tabs.sendMessage(tab.id, {
    action: "saveContent",
    text: textToSave,
    itemType: itemType,
    extraUrl: info.srcUrl || info.linkUrl || ''
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending message:", chrome.runtime.lastError);
      // 如果 content script 未加载，直接使用 tab 信息
      const fallbackData = {
        text: textToSave,
        url: info.srcUrl || info.linkUrl || tab.url,
        title: tab.title
      };
      saveContent(fallbackData);
      return;
    }
    // 保存到 storage
    saveContent(response);
  });
});

// 保存内容到 storage
async function saveContent(content) {
  try {
    const result = await chrome.storage.local.get(['apiKey', 'items']);
    const apiKey = result.apiKey;

    let newItem = {
      id: Date.now().toString(),
      text: content.text,
      url: content.url,
      title: content.title,
      savedAt: new Date().toISOString(),
      type: 'other',
      tags: [],
      summary: '',
      notes: ''
    };

    // 如果有 API Key，进行 AI 分类
    if (apiKey) {
      const classification = await classifyContent(newItem, apiKey);
      newItem.type = classification.type;
      newItem.tags = classification.tags;
      newItem.summary = classification.summary;
    }

    const items = result.items || [];
    items.unshift(newItem);

    await chrome.storage.local.set({ items });

    // 显示通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '已保存到灵感库',
      message: `${newItem.type === 'other' ? '内容' : newItem.type}已保存`
    });

  } catch (error) {
    console.error("Error saving content:", error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '保存失败',
      message: error.message
    });
  }
}

// AI 分类内容
async function classifyContent(item, apiKey) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `请分析以下内容，返回 JSON 格式：
{
  "type": "article|quote|video|prompt|tool|other",
  "tags": ["tag1", "tag2"],
  "summary": "一句话摘要"
}

内容：${item.text.substring(0, 200)}...`
        }]
      })
    });

    // 检查 HTTP 状态码
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Classification HTTP error:", response.status, errorData);
      return { type: 'other', tags: [], summary: '' };
    }

    const data = await response.json();

    // 检查 API 是否返回错误
    if (data.error) {
      console.error("Classification API error:", data.error);
      return { type: 'other', tags: [], summary: '' };
    }

    // 检查响应格式是否正确
    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error("Invalid classification API response:", data);
      return { type: 'other', tags: [], summary: '' };
    }

    const content = data.content[0].text;
    return JSON.parse(content);
  } catch (error) {
    console.error("AI classification error:", error);
    return { type: 'other', tags: [], summary: '' };
  }
}

// 监听来自其他页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getItems') {
    chrome.storage.local.get(['items'], (result) => {
      sendResponse(result.items || []);
    });
    return true;
  }

  if (request.action === 'saveQuickNote') {
    saveContent(request.data).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'updateItem') {
    chrome.storage.local.get(['items'], (result) => {
      const items = result.items || [];
      const index = items.findIndex(item => item.id === request.id);
      if (index !== -1) {
        items[index] = { ...items[index], ...request.updates };
        chrome.storage.local.set({ items });
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'deleteItem') {
    chrome.storage.local.get(['items'], (result) => {
      const items = (result.items || []).filter(item => item.id !== request.id);
      chrome.storage.local.set({ items });
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'generateDailyBrief') {
    generateDailyBrief(request.apiKey).then(brief => {
      sendResponse({ success: true, brief });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// 生成每日简报
async function generateDailyBrief(apiKey) {
  try {
    const result = await chrome.storage.local.get(['items']);
    const items = result.items || [];

    if (items.length === 0) {
      return { overview: '今日暂无收藏内容', content: '' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `请为以下收藏内容生成今日简报，格式如下：

# 今日收藏概览
[简短描述今日收藏数量和类型分布]

# 分类整理
[按类型分组展示，每个类型下列出2-3条关键内容]

# 核心洞察
[提炼出3-5条最重要的洞察或启发]

# 推荐优先阅读
[列出3条最值得深入阅读的内容及理由]

内容列表：
${items.map(item => `- [${item.type}] ${item.text.substring(0, 100)}...`).join('\n')}`
        }]
      })
    });

    // 检查 HTTP 状态码
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Brief HTTP error:', response.status, errorData);
      throw new Error(`API 请求失败 (${response.status}): ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // 检查 API 是否返回错误
    if (data.error) {
      throw new Error(data.error.message || 'API 返回错误');
    }

    // 检查响应格式是否正确
    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('Invalid API response:', data);
      throw new Error('API 响应格式无效');
    }

    const brief = data.content[0].text;

    return {
      overview: `今日收藏 ${items.length} 条内容`,
      content: brief,
      markdown: brief
    };
  } catch (error) {
    console.error('Generate daily brief error:', error);
    throw new Error('生成简报失败：' + error.message);
  }
}
