# 常驻安装教程：把 DevKit 固化为智能体预设

DevKit 作为「动态 Cordis 插件」属于**会话级能力**：DSH 进程重启后会丢失。
要让它随会话自动加载，需要把插件代码发布为 npm 包，并作为插件行写进你自有的智能体预设。

## 背景：两个平面

| 平面 | 内容 | 归属 |
|---|---|---|
| 宿主组合（host composition） | 注册表（tools/systemPrompt/agents/sessions）、持久化、会话查询、沙箱/审批栈、模型路由、子智能体注册表 | 进程级，一个实例 |
| 智能体预设（agent preset） | 该会话贡献的工具插件、人设与提示词段落、策略 | 每会话一个实例，随会话卸载 |

DevKit **只消费宿主服务**（`agents`/`subagents`/`jobs`/`fs`/`goals`/`shell`/`sandboxPolicy` 等），不发布任何服务，因此可以安全地作为普通插件行加入预设。

## 第一步：把 DevKit 打包为 npm 包

组合文件里的插件行引用的是**包名**，而不是一段 JS 源码。请参照 DSH 官方工具包的结构发布一个包（例如 `@yourscope/dsh-devkit`）：

- `package.json`：`name` 采用作用域包名，`"type": "module"`，`main` 指向宿主插件入口（参照 `@deepseek-ai/dsh-tool-fs` / `@deepseek-ai/dsh-tool-web` 的结构）
- 宿主半：把 `src/host.js` 的函数体封装为 Cordis 插件导出（`apply(ctx)` 结构不变）
- 浏览器半：DSH 通过客户端插件表（`clientModules`：增量扫描 `dsh.client`）发现包的客户端入口，请参照官方含 Web UI 的包实现 `dsh.client` 入口

发布后即可在预设中引用。

## 第二步：创建你自己的预设

自建预设位于 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`（`<id>` 匹配 `[a-z0-9][a-z0-9-]*`），每个目录包含：

```
.agent-presets/my-dev/
├── agent.cordis.yml   组合文件（插件行列表）
└── preset.yml         显示元数据（name / description）
```

推荐用 `agentPresets.copy(from, id, name)` 从现有预设复制（以 `standard` 为源），它会创建目录、改写元数据并返回实际路径，比手工复制更可靠。

## 第三步：写入插件行

编辑 `agent.cordis.yml`，添加：

```yaml
- id: devkit
  name: '@yourscope/dsh-devkit'
```

## 第四步：挂载验证

- 用 `agentPresets.standingKeyFor(id)` 做**真实组合挂载验证**——它按会话启动同样的方式组合插件子树，能准确报出：包无法解析、配置非法、行未激活、服务落入进程全局领域等四类失败
- 注意：`agentPresets.list()` 里的 `broken` 字段只是文件形状检查，**不能**当作验证依据

## 第五步：用新预设启动会话

用新预设开一个会话，确认 `devkit_*` 工具出现在工具列表、网页端出现 🧭 控制台。预设决定工具模式与提示词段落，只有真实会话能最终确认。

## 关键规则（摘自 DSH 官方技能）

1. **发布服务的行不能直接放进预设**：第二个会话挂载同一预设时会与第一个冲突。预设自有的服务必须连同所有消费者一起放进带 `isolate` 领域的 group。DevKit 不发布服务，不受此限制。
2. 不要把注册表、持久化、沙箱等宿主职责搬进预设——预设的权限与它引用的插件一致。
3. 想改动某个随部署发布的预设（如 `standard`）时，**先复制再改副本**，绝不直接编辑部署安装。

## 快速方案（不打包）

暂时不想发布 npm 包时：把 `src/host.js` 与 `src/client.js` 留在本仓库，每次 DSH 启动后让智能体执行一次 `cordis_define` + `cordis_run` 即可（会话级加载）。本仓库的 CI 也会用同样的方式做语法校验。
