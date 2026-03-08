# PawTrace AI — 开发文档

> 版本 v1.2 | 最后更新：2026-03-07 | 作者：PawTrace 团队

---

## 项目概述

PawTrace AI 是一个**纯前端宠物 SVG 生成应用**，将宠物照片通过 AI 转换为激光雕刻就绪的矢量 SVG 文件。

### 核心功能
| 功能 | 技术 |
|------|------|
| 宠物照片分析 | Google Gemini Flash Vision（多模态） |
| 卡通/线条图生成 | Google Gemini Nano Banana（图像生成） |
| 矢量化 | ImageTracer.js（纯前端 SVG 描线） |
| 登录/鉴权 | SHA-256 哈希 + localStorage 会话 |
| 管理后台 | 纯 HTML/JS + Chart.js |

---

## 目录结构

```
pettrace/
├── index.html        # 主应用页面（生成器）
├── login.html        # 登录 / 首次设置页
├── admin.html        # 管理后台页面
├── app.js            # 主应用逻辑（含会话鉴权、历史记录）
├── admin.js          # 管理后台逻辑
└── style.css         # 全局样式（暗色系设计系统）
```

---

## 本地运行

直接用浏览器打开 `login.html`：

```
file:///Users/lok/Lok's Project/pettrace/login.html
```

> [!TIP]
> 推荐使用 VS Code 的 **Live Server** 扩展（`http://127.0.0.1:5500`），避免 `file://` 协议的部分限制（如文件下载行为）。

---

## 鉴权系统

### 流程
```
首次访问
  ├─ 无用户 → login.html（创建管理员模式）
  └─ 有用户 → login.html（登录模式）
         ↓ 成功
  localStorage.pawtrace_session = { username, expires: now + 7天 }
         ↓
  index.html（主应用）/ admin.html（仅管理员）
```

### localStorage 数据键

| 键名 | 内容 |
|------|------|
| `pawtrace_users` | `Array<{username, hash, role, createdAt}>` |
| `pawtrace_session` | `{username, expires: timestamp}` |
| `pawtrace_history` | `Array<{ts, style, petName, desc, thumb}>` 最多 100 条 |
| `pawtrace_apikey` | Google AI Studio API Key 明文 |

### 密码哈希
```javascript
// salt = 'pawtrace_salt'（固定）
hash = SHA-256(password + username + salt)
```

---

## API 集成

### Gemini Flash Vision（宠物分析）
- **端点**：`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **模型优先级**：`gemini-2.0-flash-lite` → `gemini-2.5-flash` → `gemini-3-flash`
- **认证**：`x-goog-api-key: {apiKey}` 请求头
- **输入**：图片 Base64（inline_data）+ 文字提示词
- **输出**：文字描述（宠物特征）

### Gemini Nano Banana（图像生成）
- **模型优先级**：`gemini-3.1-flash-image-preview` → `gemini-2.0-flash-preview-image-generation`
- **模式**：图片+文字→图片（image-to-image，将原图传入提升相似度）
- **输出**：`candidates[0].content.parts[].inlineData.data`（Base64 PNG）
- **注意**：无需 `generationConfig`；仅支持 AI Studio Key，不支持 Vertex AI Key

### ImageTracer.js（矢量化）
```javascript
ImageTracer.imagedataToSVG(imageData, {
    colorsampling: 0,      // 使用明确调色板
    pal: [{r:0,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}],
    numberofcolors: 2,
    ltres: 1,              // 线条阈值
    pathomit: 8            // 忽略小路径
})
```

---

## 部署指南

### GitHub Pages（免费）
```bash
cd "/Users/lok/Lok's Project/pettrace"
git init
git add .
git commit -m "Initial deploy"
# 在 GitHub 创建仓库后：
git remote add origin https://github.com/YOUR_USERNAME/pawtrace.git
git push -u origin main
# 在 GitHub Settings > Pages > 选择 main 分支
```

访问地址：`https://YOUR_USERNAME.github.io/pawtrace/login.html`

### Netlify（拖拽部署）
1. 打开 [netlify.com](https://netlify.com) → "Add new site" → "Deploy manually"
2. 将 `pettrace/` 文件夹**拖入**部署区域
3. 自动获得 `https://xxx.netlify.app` 地址

> [!IMPORTANT]
> 部署到公网后，建议将 **API Key 改为后端代理**（避免暴露在客户端）。参见「未来迁移路径」。

---

## 未来更新方向

### 🔜 短期（v1.3）
- [ ] **图片质量提升**：加入 Real-ESRGAN 超分辨率（Transformers.js，纯前端）
- [ ] **更多风格**：Stencil 镂空风、水彩墨迹风、像素像素风
- [ ] **批量生成**：支持一次上传多张照片，队列生成
- [ ] **SVG 预览增强**：在线拖拽调整文字位置和大小

### 📅 中期（v2.0）— 迁移到服务端
```
前端 (Vite/Next.js)
    ↕
后端 API (Bun/Node.js + Hono)
    ├── /api/generate    ← 代理 Gemini API（隐藏 Key）
    ├── /api/auth        ← JWTRefreshToken
    └── /api/history     ← PostgreSQL 持久化历史
```
- [ ] Firebase Auth / Supabase Auth（替换 localStorage 鉴权）
- [ ] 用户生成记录云端存储
- [ ] Stripe 支付 + 按次计费 / 订阅制
- [ ] 多语言支持（i18n）

### 🚀 长期（v3.0）- SaaS 方向
- [ ] **品牌定制**：用户上传 LOGO、自定义字体
- [ ] **商家版**：宠物店/摄影师工作流（批量订单 → 自动发图）
- [ ] **xTool 深度集成**：直接通过 xTool API 发送雕刻任务
- [ ] **移动端 App**：React Native / Flutter 包

---

## 开发规范

### 代码风格
- 原生 HTML/CSS/JS，无构建工具依赖（方便直接 `file://` 运行）
- `async/await` 全程，避免 Promise 链
- localStorage Key 用 `pawtrace_` 前缀统一管理

### 调试
```javascript
// 查看历史
JSON.parse(localStorage.getItem('pawtrace_history'))

// 清除所有数据（登录页也提供 UI 入口）
['pawtrace_users','pawtrace_session','pawtrace_history','pawtrace_apikey']
  .forEach(k => localStorage.removeItem(k))
```

### 添加新风格
1. 在 `app.js` 的 `stylePrompts` 对象新增键值对
2. 在 `index.html` 的 `.style-grid` 添加新风格卡片
3. 在 `admin.js` 的 `styleLabels` / `counts` 对象中对应添加

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| SVG 全黑 | ImageTracer 颜色格式问题 | 已修复：使用亮度值判断白色 |
| 图像不像原宠物 | 纯文字→图像信息损失 | 已修复：原图直接发给 Nano Banana |
| 下载文件无扩展名 | `file://` 协议忽略 `download` 属性 | 已修复：改用 `showSaveFilePicker` |
| API Key 格式错误 | 非 `AIza...` 开头 | 在 [aistudio.google.com](https://aistudio.google.com) 重新获取 |
| 图像生成失败 | Nano Banana 模型不可用 | 系统会自动尝试备用模型 |
