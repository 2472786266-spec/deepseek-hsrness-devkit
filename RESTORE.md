# 开发增强套件 · 恢复流程（重启后）

DSH 动态插件（开发增强套件）定义只存在进程内存，**重启即丢**。
恢复很简单：源码已固化在 `src/host.js` 与 `src/client.js`（当前版本 v4.8.2）。

## 用户日常流程

1. 双击桌面快捷方式「DSH开发套件」（或运行 `start-devkit.ps1`）→ 自动启动 DSH + 打开浏览器
2. 在会话里发一句：**「恢复开发套件」**
3. Agent 自动完成恢复（读文件 → `cordis_define` → `cordis_run`，约 1 分钟）

## Agent 恢复步骤（供以后会话参考）

1. `read` `src/client.js` 和 `src/host.js` 全文
2. `cordis_define`：
   - `plugin.kind: "new"`，`idPrefix: "devkt"`（新进程重启后 pluginId 会变）
   - `code.client` = client.js 内容（含 v4.8.2 自建色板）
   - `code.host` = host.js 内容
3. `cordis_run`（mode `run`）→ 用户在页面点「允许」
4. 版本号当前为 **v4.8.2**（自建高对比色板，亮暗主题自适应，实色可读）

## 关键提示

- **不要刷新页面**：DSH 只在激活时把客户端代码推给当时连接的页面；刷新会断开，需重新 `cordis_run` 推送。
- 视觉模型（识图）依赖用户在「设置 → 开发增强套件」配置的 API Key，存于 DSH 凭据库，重启后仍保留。
- 图库数据存于工作区 `.dsh-media/`，重启后仍保留。
