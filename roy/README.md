# Roy

hello

---

# 划词卡片 Chrome 插件

在网页上选中文字，一键生成精美分享卡片并自动复制到剪贴板。

## 功能

| 功能 | 说明 |
|------|------|
| ✂️ 文字捕获 | 选中文字后出现悬浮按钮，或右键菜单触发 |
| 🎨 卡片渲染 | Canvas 绘制：渐变背景、高亮文字、来源域名、二维码 |
| 📋 复制到剪贴板 | 自动写入 PNG 图片，可直接粘贴到微信/微博等 |
| 💾 历史记录 | 点击插件图标查看、复制、删除历史卡片 |

## 文件结构

```
roy/
├── manifest.json       # Chrome 扩展配置（MV3）
├── background.js       # Service Worker：右键菜单、QR 代理、历史存储
├── card-renderer.js    # Canvas 卡片绘制逻辑（注入到网页）
├── content.js          # 网页交互：悬浮按钮、选区检测、预览弹窗
├── content.css         # 悬浮按钮 / 弹窗样式
├── popup.html          # 插件弹出页面 HTML
├── popup.js            # 弹出页面逻辑：历史列表、主题切换
└── popup.css           # 弹出页面样式
```

## 安装（开发者模式）

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录（`roy/`）
4. 浏览器工具栏出现 ✂️ 图标即安装成功

> **注意**：需要手动添加图标文件 `icons/icon16.png`、`icons/icon48.png`、`icons/icon128.png`，否则工具栏显示默认图标（不影响功能）。

## 使用方法

1. 在任意网页选中一段文字
2. 点击旁边出现的 **悬浮按钮** 或右键选择「生成划词卡片 ✂️」
3. 卡片自动生成并**复制到剪贴板**
4. 弹出预览窗口，可切换主题、下载图片

## 4 种主题

| # | 名称 | 配色 |
|---|------|------|
| 0 | 深空 | `#0f0c29` → `#302b63` 金色高亮 |
| 1 | 午夜 | `#1a1a2e` → `#0f3460` 红色高亮 |
| 2 | 深渊 | `#0f2027` → `#2c5364` 绿色高亮 |
| 3 | 熔岩 | `#2d1b69` → `#38ef7d` 金色高亮 |

## 二维码说明

二维码通过 `api.qrserver.com` 在线生成（需要网络）。离线状态下会显示装饰性占位图案。

## 技术架构

```
用户选中文字
    │
    ├─► 悬浮按钮点击 (content.js)
    └─► 右键菜单 → background.js → sendMessage
              ↓
        generateCard()
              │
              ├─► sendMessage('fetchQR') → background.js 请求 qrserver.com
              ├─► CardRenderer.render() 绘制 Canvas
              ├─► navigator.clipboard.write() 复制 PNG
              ├─► chrome.storage.local 保存缩略图
              └─► 展示预览弹窗
```
