document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
  const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
  const exportDataBtn = document.getElementById('exportDataBtn');
  const importDataBtn = document.getElementById('importDataBtn');
  const importFileInput = document.getElementById('importFileInput');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const notification = document.getElementById('notification');

  // 加载已保存的 API Key
  chrome.storage.local.get(['apiKey'], (result) => {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
  });

  // 保存 API Key
  saveApiKeyBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showNotification('请输入 API Key', 'error');
      return;
    }

    chrome.storage.local.set({ apiKey }, () => {
      showNotification('API Key 已保存', 'success');
    });
  });

  // 清除 API Key
  clearApiKeyBtn.addEventListener('click', () => {
    if (confirm('确定要清除 API Key 吗？')) {
      chrome.storage.local.remove(['apiKey'], () => {
        apiKeyInput.value = '';
        showNotification('API Key 已清除', 'success');
      });
    }
  });

  // 导出数据
  exportDataBtn.addEventListener('click', () => {
    chrome.storage.local.get(null, (data) => {
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        data: data
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inspiration-collector-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showNotification('数据已导出', 'success');
    });
  });

  // 导入数据按钮
  importDataBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  // 导入数据
  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        if (!importData.data) {
          throw new Error('无效的数据格式');
        }

        if (confirm(`确定要导入数据吗？这将覆盖现有数据。`)) {
          chrome.storage.local.set(importData.data, () => {
            showNotification('数据已导入', 'success');
          });
        }
      } catch (error) {
        showNotification('导入失败: ' + error.message, 'error');
      }
    };
    reader.readAsText(file);
    importFileInput.value = '';
  });

  // 清除所有数据
  clearAllBtn.addEventListener('click', () => {
    if (confirm('确定要清除所有数据吗？此操作不可恢复！')) {
      if (confirm('真的要删除所有收藏的内容吗？')) {
        chrome.storage.local.clear(() => {
          showNotification('所有数据已清除', 'success');
          apiKeyInput.value = '';
        });
      }
    }
  });

  // 显示通知
  function showNotification(message, type) {
    notification.textContent = message;
    notification.className = 'notification ' + type;
    notification.style.display = 'block';

    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  }
});
