document.addEventListener('DOMContentLoaded', () => {
  let allItems = [];
  let currentBrief = '';

  const searchInput = document.getElementById('searchInput');
  const typeFilter = document.getElementById('typeFilter');
  const tagFilter = document.getElementById('tagFilter');
  const itemsContainer = document.getElementById('itemsContainer');
  const generateBriefBtn = document.getElementById('generateBriefBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const briefModal = document.getElementById('briefModal');
  const closeBriefBtn = document.getElementById('closeBriefBtn');
  const briefContent = document.getElementById('briefContent');
  const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');

  // 加载所有内容
  loadItems();

  // 设置按钮 - 使用 Chrome API 打开设置页面
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 搜索和过滤
  searchInput.addEventListener('input', renderItems);
  typeFilter.addEventListener('change', renderItems);
  tagFilter.addEventListener('change', renderItems);

  // 生成今日简报
  generateBriefBtn.addEventListener('click', async () => {
    generateBriefBtn.disabled = true;
    generateBriefBtn.textContent = '生成中...';

    try {
      const result = await chrome.storage.local.get(['apiKey']);
      const apiKey = result.apiKey;

      if (!apiKey) {
        alert('请先在设置中配置 Claude API Key');
        return;
      }

      chrome.runtime.sendMessage({
        action: 'generateDailyBrief',
        apiKey
      }, (response) => {
        if (response && response.success) {
          currentBrief = response.brief.content;
          briefContent.innerHTML = formatBrief(response.brief);
          briefModal.style.display = 'flex';
        } else {
          alert('生成简报失败: ' + (response?.error || '未知错误'));
        }
        generateBriefBtn.disabled = false;
        generateBriefBtn.textContent = '生成今日简报';
      });
    } catch (error) {
      console.error(error);
      alert('生成简报失败: ' + error.message);
      generateBriefBtn.disabled = false;
      generateBriefBtn.textContent = '生成今日简报';
    }
  });

  // 关闭简报模态框
  closeBriefBtn.addEventListener('click', () => {
    briefModal.style.display = 'none';
  });

  briefModal.addEventListener('click', (e) => {
    if (e.target === briefModal) {
      briefModal.style.display = 'none';
    }
  });

  // 导出 Markdown
  exportMarkdownBtn.addEventListener('click', () => {
    downloadMarkdown(currentBrief, 'inspiration-daily-brief.md');
  });

  // 加载内容
  async function loadItems() {
    chrome.runtime.sendMessage({ action: 'getItems' }, (items) => {
      allItems = items || [];
      updateTagFilter();
      renderItems();
    });
  }

  // 更新标签过滤器
  function updateTagFilter() {
    const allTags = new Set();
    allItems.forEach(item => {
      item.tags?.forEach(tag => allTags.add(tag));
    });

    const currentValue = tagFilter.value;
    tagFilter.innerHTML = '<option value="">所有标签</option>';
    allTags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      tagFilter.appendChild(option);
    });

    if (allTags.has(currentValue)) {
      tagFilter.value = currentValue;
    }
  }

  // 渲染内容卡片
  function renderItems() {
    const searchTerm = searchInput.value.toLowerCase();
    const typeValue = typeFilter.value;
    const tagValue = tagFilter.value;

    const filteredItems = allItems.filter(item => {
      const matchesSearch = !searchTerm ||
        item.text.toLowerCase().includes(searchTerm) ||
        (item.summary && item.summary.toLowerCase().includes(searchTerm)) ||
        (item.notes && item.notes.toLowerCase().includes(searchTerm));

      const matchesType = !typeValue || item.type === typeValue;
      const matchesTag = !tagValue || (item.tags && item.tags.includes(tagValue));

      return matchesSearch && matchesType && matchesTag;
    });

    if (filteredItems.length === 0) {
      itemsContainer.innerHTML = '<div class="empty-state">暂无内容，开始收集你的灵感吧！</div>';
      return;
    }

    itemsContainer.innerHTML = filteredItems.map(item => createItemCard(item)).join('');

    // 绑定卡片事件
    document.querySelectorAll('.item-card').forEach(card => {
      const itemId = card.dataset.id;

      // 删除按钮
      card.querySelector('.delete-btn').addEventListener('click', () => {
        if (confirm('确定要删除这条内容吗？')) {
          deleteItem(itemId);
        }
      });

      // 编辑备注
      const notesArea = card.querySelector('.notes-area');
      const editNotesBtn = card.querySelector('.edit-notes-btn');

      editNotesBtn.addEventListener('click', () => {
        notesArea.classList.toggle('editing');
        if (notesArea.classList.contains('editing')) {
          notesArea.focus();
        } else {
          // 保存备注
          const notes = notesArea.value.trim();
          updateItem(itemId, { notes });
        }
      });

      notesArea.addEventListener('blur', () => {
        const notes = notesArea.value.trim();
        updateItem(itemId, { notes });
        notesArea.classList.remove('editing');
      });

      // 标签编辑
      const tagsContainer = card.querySelector('.tags-container');
      const addTagBtn = card.querySelector('.add-tag-btn');

      addTagBtn.addEventListener('click', () => {
        const tag = prompt('输入新标签:');
        if (tag && tag.trim()) {
          const currentTags = item.tags || [];
          if (!currentTags.includes(tag.trim())) {
            const newTags = [...currentTags, tag.trim()];
            updateItem(itemId, { tags: newTags }).then(() => {
              loadItems();
            });
          }
        }
      });

      tagsContainer.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tagToRemove = e.target.dataset.tag;
          const currentTags = item.tags || [];
          const newTags = currentTags.filter(t => t !== tagToRemove);
          updateItem(itemId, { tags: newTags }).then(() => {
            loadItems();
          });
        });
      });
    });
  }

  // 创建内容卡片
  function createItemCard(item) {
    const date = new Date(item.savedAt).toLocaleDateString('zh-CN');
    const typeLabels = {
      article: '文章',
      quote: '金句',
      video: '视频',
      prompt: 'Prompt',
      tool: '工具',
      other: '其他'
    };
    const typeColors = {
      article: 'type-article',
      quote: 'type-quote',
      video: 'type-video',
      prompt: 'type-prompt',
      tool: 'type-tool',
      other: 'type-other'
    };

    const tagsHtml = (item.tags || []).map(tag =>
      `<span class="tag"><span class="tag-text">${tag}</span><span class="tag-remove" data-tag="${tag}">×</span></span>`
    ).join('');

    return `
      <div class="item-card" data-id="${item.id}">
        <div class="item-header">
          <span class="item-type ${typeColors[item.type] || 'type-other'}">${typeLabels[item.type] || '其他'}</span>
          <span class="item-date">${date}</span>
        </div>
        <div class="item-content">${escapeHtml(item.text)}</div>
        ${item.summary ? `<div class="item-summary">${escapeHtml(item.summary)}</div>` : ''}
        ${item.url ? `<div class="item-url"><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a></div>` : ''}
        <div class="tags-container">${tagsHtml}</div>
        <textarea class="notes-area" placeholder="添加备注...">${escapeHtml(item.notes || '')}</textarea>
        <div class="item-actions">
          <button class="btn btn-sm edit-notes-btn">编辑备注</button>
          <button class="btn btn-sm btn-danger add-tag-btn">+ 标签</button>
          <button class="btn btn-sm btn-danger delete-btn">删除</button>
        </div>
      </div>
    `;
  }

  // 更新条目
  function updateItem(id, updates) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'updateItem',
        id,
        updates
      }, (response) => {
        const item = allItems.find(i => i.id === id);
        if (item) {
          Object.assign(item, updates);
        }
        resolve(response);
      });
    });
  }

  // 删除条目
  function deleteItem(id) {
    chrome.runtime.sendMessage({
      action: 'deleteItem',
      id
    }, (response) => {
      if (response && response.success) {
        allItems = allItems.filter(item => item.id !== id);
        updateTagFilter();
        renderItems();
      }
    });
  }

  // 格式化简报
  function formatBrief(brief) {
    return `
      <div class="brief-overview">${brief.overview}</div>
      <div class="brief-content">${brief.content.replace(/\n/g, '<br>')}</div>
    `;
  }

  // 下载 Markdown
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
