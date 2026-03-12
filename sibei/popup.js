document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveBtn');
  const contentInput = document.getElementById('contentInput');
  const urlInput = document.getElementById('urlInput');
  const notification = document.getElementById('notification');
  const settingsLink = document.getElementById('settingsLink');

  // 设置链接 - 使用 Chrome API 打开设置页面
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // 获取当前标签页 URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      urlInput.value = tabs[0].url;
    }
  });

  // 保存按钮点击
  saveBtn.addEventListener('click', async () => {
    const text = contentInput.value.trim();
    const url = urlInput.value.trim();

    if (!text) {
      showNotification('请输入内容', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
      const data = {
        text,
        url: url || window.location.href,
        title: '手动保存',
        savedAt: new Date().toISOString()
      };

      chrome.runtime.sendMessage({
        action: 'saveQuickNote',
        data
      }, (response) => {
        if (response && response.success) {
          showNotification('保存成功！', 'success');
          contentInput.value = '';
        } else {
          showNotification('保存失败', 'error');
        }
        saveBtn.disabled = false;
        saveBtn.textContent = '保存到灵感库';
      });

    } catch (error) {
      console.error(error);
      showNotification('保存失败: ' + error.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存到灵感库';
    }
  });

  // 显示通知
  function showNotification(message, type) {
    notification.textContent = message;
    notification.className = 'notification ' + type;
    notification.style.display = 'block';

    setTimeout(() => {
      notification.style.display = 'none';
    }, 2000);
  }
});
