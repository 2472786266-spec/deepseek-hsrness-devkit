# DSH 开发增强套件 (DevKit)

> DeepSeek Harness 动态 Cordis 插件：**多模态图库 + 多智能体监督控制台**，为大项目开发而生。

![CI](https://github.com/2472786266-spec/deepseek-hsrness-devkit/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue)

本插件以「动态 Cordis 插件包」（Host 半 + Client 半）的形式运行在 DeepSeek Harness（DSH）中：宿主半运行在 Node.js 进程内，负责状态聚合、子智能体操作、媒体存取与模型工具注册；浏览器半以 React 组件注入 DSH 网页端的官方插槽，提供完整的中文控制台界面。

## 📸 界面预览

| 智能体监督 | 多模态图库 | 后台任务 |
|---|---|---|
| ![智能体](docs/screenshots/console-agents.png) | ![图库](docs/screenshots/console-media.png) | ![任务](docs/screenshots/console-jobs.png) |

| 工作流监督 | 目标总览 |
|---|---|
| ![工作流](docs/screenshots/console-workflows.png) | ![目标](docs/screenshots/console-goal.png) |

## ✨ 功能特性

### 🧭 多智能体监督控制台
- **实时总览**：主会话与所有子智能体（★ 标记当前会话），状态点区分 🟢运行中 / 🔵空闲 / ⚪就绪(可唤醒) / 已结束，每 2.5 秒自动刷新
- **发消息**：向任意子智能体追加任务（作为它的下一轮，可唤醒休眠的子智能体）
- **打断**：一键停止子智能体当前轮次（已排队消息保留）
- **后台任务**：查看全部后台任务并一键请求结束
- **工作流**：工作流运行状态、当前阶段、最近日志、最近错误
- **目标**：当前会话目标（objective / 阶段 / 轮次 / 阻塞原因）总览

### 🖼 多模态媒体图库
- **两种上传方式**：浏览器选择文件上传 / 输入本机绝对路径导入
- **自动校验**：仅接受 PNG / JPEG / GIF / WebP，限制 8MB
- **自动解码**：通过 pwsh 把 base64 落为真实图片文件，供模型 `read_image` 直接查看
- **插入消息**：一键把图片引用写入聊天输入框，实现「上传图片 → 智能体看图分析」的完整闭环
- 模型侧可用 `devkit_media_save` 把生成的图表/截图直接交付到图库

### 🔧 页面增强
- 输入框上方**实时状态条**：智能体 / 运行 / 任务 / 图库 计数
- 侧边栏底部 **🧭 控制台** 入口（运行数红色徽章）
- 可拖拽的控制台面板（明暗主题自适应）

### 🤖 模型侧监督工具（4 个）
| 工具 | 用途 |
|---|---|
| `devkit_agents` | 查看智能体/任务/目标/工作流快照 |
| `devkit_send_agent_message` | 向子智能体发消息 |
| `devkit_interrupt_agent` | 打断子智能体当前轮次 |
| `devkit_media_save` | 保存图片到用户图库 |

---

## 📦 文件结构

```
dsh-devkit/
├── README.md                本文件
├── LICENSE                  MIT 许可证
├── docs/
│   ├── preset-install.md    常驻安装教程（固化为智能体预设）
│   └── screenshots/         界面截图
├── src/
│   ├── host.js              Host 半（Node）：状态聚合、RPC、动态工具
│   └── client.js            Client 半（浏览器）：React 控制台 UI
├── tools/
│   └── screenshot.mjs       无头浏览器截图工具（CDP 驱动）
└── .github/                 Issue/PR 模板与 CI（语法校验）
```

---

## 🚀 安装方式

### 方式一：GUI 动态加载（最快，会话级）
1. 在 DSH 网页端对话中，让智能体执行 `cordis_define`：
   - `code.host` 粘贴 `src/host.js` 的内容
   - `code.client` 粘贴 `src/client.js` 的内容
2. 执行 `cordis_run` 并在运行卡片上批准（勾选双勾可授权未来版本）。
3. 页面立即出现 🧭 控制台。

### 方式二：固化为常驻预设（重启不丢失）
详见 [docs/preset-install.md](docs/preset-install.md)：把插件发布为 npm 包后，作为插件行写入你自有预设的 `agent.cordis.yml`。

### 依赖说明
- 运行于 DSH（Node.js + Web GUI），使用其官方服务与插槽：`agents`、`subagents`、`jobs`、`fs`、`goals`、`shell`、`sandboxPolicy`（宿主侧）与 `slots`、`timer`（浏览器侧）
- 图片「自动解码为真实文件」依赖本机 `pwsh`；缺失时自动降级为 base64 文本存储（不影响图库预览）

---

## 🔌 包内 RPC 接口（Client → Host）

| 方法 | 参数 | 说明 |
|---|---|---|
| `state` | `{}` | 全部监督数据快照（智能体/任务/目标/工作流/日志/错误/媒体） |
| `media-save` | `{name, base64}` | 保存图片（自动校验+解码） |
| `media-import` | `{path}` | 从本机路径导入图片 |
| `media-read` | `{ref}` | 读取图片 base64（供缩略图） |
| `media-delete` | `{ref}` | 从图库删除 |
| `agent-message` | `{agentId, text}` | 向子智能体发消息 |
| `agent-interrupt` | `{agentId}` | 打断子智能体 |
| `job-kill` | `{jobId}` | 结束后台任务 |

---

## 🛠 开发

- 语法校验：`node -e "new Function(require('fs').readFileSync('src/host.js','utf8'))"`（client 同理）
- 截图工具：`tools/screenshot.mjs` 通过 CDP 驱动无头 Edge 截取真实控制台面板（README 中的截图即出自它）

## ⚠️ 已知限制

- 动态插件为**进程级生命周期**：DSH 重启后需重新激活（方式二可解决）
- 图库数据保存在工作区（`.dsh-media/` 子目录；旧版本遗留文件为 `.dsh-media-*.txt`）
- 「路径导入」读取本机文件，依赖 DSH 的文件沙箱策略

## 🕰 更新日志

### v2.0
- 修复「插入消息」失效：改用真实 `InputActions.setDraft` API，自动追加到当前草稿末尾；自动插入失败时提供可复制文本框兜底
- 智能体显示真实会话标题；主会话固定显示「★ 主会话」；深层子智能体按 `parentId` 正确投递消息
- 禁止给主会话自己发消息 / 打断主会话
- 媒体文件归入 `.dsh-media/` 子目录（兼容读取旧版文件）
- 控制台新增「刷新」「复位位置」按钮；状态条新增刷新按钮；拖拽偏移修正

### v1.3（初始发布）
- 多模态图库、多智能体监督控制台、8 个包内 RPC、4 个模型工具

## 📄 许可证

[MIT](./LICENSE) © 2026 deepseek-Hsrness 社区
