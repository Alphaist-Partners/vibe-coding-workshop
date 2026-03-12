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

// 模型配置
const API_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const modelMap = {
  classify: 'glm-4.5',   // 轻量分类 → 省 token
  summarize: 'glm-4.5',  // 摘要生成 → 省 token
  digest: 'glm-4.7'      // 简报生成 → 最优效果
};

// 统一的 AI 调用函数
async function callAI(task, content, apiKey) {
  const model = modelMap[task];

  let systemPrompt = '';
  let userPrompt = '';

  switch (task) {
    case 'classify':
      systemPrompt = '你是一个内容分类助手。请分析用户输入的内容，返回 JSON 格式，只包含 type（类型）、tags（标签数组）、summary（一句话摘要）三个字段。type 取值：article（文章摘录）、quote（金句）、video（视频链接）、prompt（Prompt）、tool（工具）、link（链接）、page（页面）、image（图片）、other（其他）。tags 是 2-3 个相关话题标签。summary 是不超过 50 字的一句话摘要。';
      userPrompt = content.text.substring(0, 500);
      break;

    case 'summarize':
      systemPrompt = '你是一个摘要助手。请为用户提供的内容生成一句话摘要，不超过 50 字。';
      userPrompt = content.text.substring(0, 1000);
      break;

    case 'digest':
      systemPrompt = '你是一个内容整理助手。请为用户的收藏内容生成今日简报，使用 Markdown 格式。结构包括：# 今日收藏概览、# 分类整理、# 核心洞察、# 推荐优先阅读。每个部分都要有实际内容，不要空泛而谈。';
      userPrompt = content.map(item => `- [${item.type}] ${item.text.substring(0, 150)}`).join('\n');
      break;
  }

  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: task === 'digest' ? 0.7 : 0.3,
      max_tokens: task === 'digest' ? 2000 : 500
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error(`AI API error (${response.status}):`, errorData);
    throw new Error(`API 请求失败 (${response.status}): ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    console.error('AI API returned error:', data.error);
    throw new Error(data.error.message || 'API 返回错误');
  }

  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    console.error('Invalid AI API response:', data);
    throw new Error('API 响应格式无效');
  }

  return data.choices[0].message.content;
}

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
    const response = await callAI('classify', item, apiKey);
    return JSON.parse(response);
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

    const brief = await callAI('digest', items, apiKey);

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
