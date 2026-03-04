# icons/

此目录存放扩展图标文件。

Chrome 扩展需要以下尺寸的 PNG 图标：

| 文件名 | 尺寸 | 用途 |
|--------|------|------|
| icon16.png | 16×16 | 浏览器工具栏 |
| icon48.png | 48×48 | 扩展管理页 |
| icon128.png | 128×128 | Chrome 商店 |

## 生成方法

在工作坊中，可以对 Claude Code 说：

> "帮我生成一套简约风格的扩展图标，主题色 #4F46E5，包含一个引号或卡片图案，
> 导出 16/48/128 三种尺寸的 PNG。"

Claude Code 可以用 Canvas 或 SVG 生成简单的图标，也可以：

1. 使用 Pollinations.ai 生成 AI 图标
2. 用任意图片编辑工具手动创建
3. 使用免费图标网站如 [Flaticon](https://www.flaticon.com)

> 💡 开发阶段可以先不放图标，Chrome 会显示默认图标。
