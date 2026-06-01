# codex-web

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/) [![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev/) [![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)

给 [Codex CLI](https://github.com/openai/codex) 套了一层 Web 界面。在局域网里的任何设备上打开浏览器就能用，不用再盯着终端。

> 适合部署在个人电脑、内网服务器或虚拟局域网环境。不建议直接暴露到公网。

---

## 为什么做这个

Codex CLI 本身轻量好用，但终端界面有它的局限：

- 想在手机或平板上看一眼进度，做不到
- 多设备访问、后台查看和通知提醒不够方便

所以做了这个 Web 壳。核心思路很简单：**Codex CLI 负责干活，Web UI 负责看和操作**。只要设备有浏览器、能访问到你的局域网，就能用。

---

## 主要功能

**对话与会话管理**

- 浏览器里的 Codex 聊天界面，支持图片粘贴、附件上传和图片预览
- 读取 Codex CLI 已有的会话列表，可以在 Web 里恢复上下文、继续对话
- 会话标题自动生成
- 工具调用、文件变更和审批请求都会展示在界面里

**后台执行**

- 任务跑在后端连接的 Codex CLI 里，不是跑在浏览器里
- 关掉浏览器标签页，任务照常执行，事件照常记录
- 重新打开页面，自动恢复当前任务状态（执行中 / 已完成 / 失败）

**任务完成通知**

- 交给 AI 一个重活，可能要跑十几分钟甚至半小时
- 这段时间你可以去干别的事，等 AI 完成后通过通知渠道告诉你
- 内置 5 种通知渠道，也支持自定义 Webhook

**常用选项**

- 支持切换模型、工作模式、推理强度等设置
- 支持本地密码访问控制

---

## 前置要求

开始之前，确认你的环境满足以下条件：

- **Node.js 22+**
- **npm**
- **Codex CLI 已安装并可正常使用**（已登录、能跑通）
- 当前机器能启动 `codex app-server`
- 项目目录可写（尤其是 `.data` 或你配置的 `DATA_DIR`）

快速检查：

```bash
node -v       # >= 22
npm -v
codex --version
```

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/guhuo-km/codex-web.git
cd codex-web
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

然后根据需要修改 `.env`，详见下方 [配置项说明](#配置项说明)。

### 4. 启动

**开发模式**（需要两个终端）：

```bash
# 终端 1：启动后端
npm run dev

# 终端 2：启动前端开发服务器
npm run dev:web
```

开发模式下，后端和前端是两个独立的服务。后端由 `tsx watch` 驱动，修改后端代码会自动重启；前端由 Vite 提供 HMR 热更新，改页面即时生效。前端开发服务器会把 `/api`、`/ws`、`/icons` 代理到后端。

**生产模式**：

```bash
npm run build
npm start
```

生产模式下，前端会被构建为静态文件，由后端统一托管，只需要一个进程。

---

## 配置项说明

| 配置项 | 必填 | 默认值 | 说明 |
|---|:---:|:---:|---|
| `CODEX_WEB_PASSWORD` | 否 | `root` | 登录密码。建议修改。 |
| `CODEX_WEB_AUTH_ENABLED` | 否 | `true` | 是否启用本地登录。 |
| `CODEX_WEB_HOST` | 否 | `0.0.0.0` | 后端监听地址。局域网访问保持默认即可。 |
| `CODEX_WEB_BACKEND_PORT` | 否 | `49380` | 后端端口，生产模式入口也是这个端口。 |
| `CODEX_WEB_FRONTEND_PORT` | 否 | `49381` | 开发模式前端端口。 |
| `PUBLIC_BASE_URL` | 否 | 空 | 对外可访问的基础地址，用于生成回调或外链。 |
| `CODEX_BIN` | 否 | `codex` | Codex CLI 可执行文件名或路径。 |
| `CODEX_HOME` | 否 | 空 | 指定 Codex CLI 的工作目录。 |
| `CODEX_APP_SERVER_PORT` | 否 | `49319` | 内部 `codex app-server` 端口。 |
| `DATA_DIR` | 否 | `.data` | 本地数据目录，保存项目、通知和偏好设置。 |
| `ENABLE_EXPERIMENTAL_CODEX_API` | 否 | `true` | 是否启用 Codex 的实验性接口。 |

---

## 通知

这是一个比较重要的功能。当你把一个耗时较长的任务交给 AI，不需要一直盯着页面等结果。任务完成后，codex-web 会通过你配置的通知渠道发消息告诉你。

### 内置通知渠道

| 渠道 | 请求地址 | 官网 / 配置入口 |
|---|---|---|
| PushPlus | `https://www.pushplus.plus/send` | [pushplus.plus](https://www.pushplus.plus/) |
| Telegram | `https://api.telegram.org/bot<botToken>/sendMessage` | [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage) |
| Server酱 | `https://sctapi.ftqq.com/<sendKey>.send` | [sct.ftqq.com](https://sct.ftqq.com/) |
| 飞书机器人 | 用户填写的飞书 Webhook 地址 | [飞书自定义机器人文档](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) |
| Qmsg | `https://qmsg.zendee.cn/send` | [qmsg.zendee.cn](https://qmsg.zendee.cn/) |

每种渠道可以在界面中单独配置对应参数并启用，支持测试发送，方便确认是否可达。

飞书比较特殊：每个机器人的 Webhook 地址不同，需要你在界面里填入自己的 `webhookUrl`。

### 自定义通知渠道

如果内置渠道不满足需求，可以新建自定义通知渠道，本质上是发一个 HTTP 请求到你指定的 Webhook。

**需要填写的内容：**

| 字段 | 说明 |
|---|---|
| Method | 请求方法，一般选 `POST`，也支持 `PUT`、`PATCH` |
| URL | 你的 Webhook 地址 |
| Headers JSON | 请求头，必须是合法的 JSON 对象 |
| Body | 选择 `JSON` 或 `Text` |
| Body Template | 请求体模板，支持变量替换 |
| Timeout | 超时时间 |

**可用模板变量：**

| 变量 | 说明 |
|---|---|
| `{{title}}` | 通知标题 |
| `{{message}}` | 通知内容 |
| `{{source}}` | 来源 |
| `{{threadId}}` | 会话 ID |
| `{{turnId}}` | 轮次 ID |
| `{{durationMs}}` | 任务耗时（毫秒） |
| `{{errorMessage}}` | 错误信息（如有） |
| `{{tokenUsage.totalTokens}}` | 总 Token 数 |
| `{{tokenUsage.inputTokens}}` | 输入 Token 数 |
| `{{tokenUsage.outputTokens}}` | 输出 Token 数 |

**JSON 模板示例：**

```json
{
  "title": "{{title}}",
  "message": "{{message}}",
  "source": "{{source}}",
  "threadId": "{{threadId}}",
  "turnId": "{{turnId}}",
  "durationMs": "{{durationMs}}",
  "error": "{{errorMessage}}",
  "tokens": "{{tokenUsage.totalTokens}}"
}
```

**纯文本模板示例：**

```text
{{title}}

{{message}}

thread={{threadId}}
turn={{turnId}}
duration={{durationMs}}ms
tokens={{tokenUsage.totalTokens}}
error={{errorMessage}}
```

**飞书机器人 JSON 示例：**

```json
{
  "msg_type": "text",
  "content": {
    "text": "{{title}}\n{{message}}\nthread={{threadId}}\ntokens={{tokenUsage.totalTokens}}"
  }
}
```

> Headers JSON 必须是合法 JSON 对象，不能写成多行 `key: value` 格式。Body 选 JSON 时，模板渲染后也必须是合法 JSON。

---

## 架构

```text
┌──────────────────────────────────────────────────────────┐
│                        浏览器                             │
│                  React + Vite 前端                        │
│          HTTP API / WebSocket /ws 连接后端                 │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   Node.js 后端                            │
│          Express + WebSocket + 文件持久化                  │
│      JSON-RPC over WebSocket 连接 codex app-server        │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                 codex app-server                         │
│                   Codex CLI                              │
└──────────────────────────────────────────────────────────┘
```

- **前端**：展示会话、工具调用、文件变更、通知设置等内容。UI 组件基于 Radix UI，Markdown 渲染支持代码高亮、Mermaid 图表和 KaTeX 公式。
- **后端**：启动并连接 `codex app-server`，将 Codex 事件和状态整理为 HTTP / WebSocket 接口，同时负责数据持久化、通知推送和访问控制。
- **数据层**：`.data` 目录下的 JSON / JSONL 文件，保存项目、线程、通知配置、主题和偏好设置。页面刷新或重新打开后可恢复状态。

核心思路：Codex CLI 是执行引擎，Web UI 是控制台。逻辑不塞进页面里。

---

## 生产部署

```bash
npm install
cp .env.example .env   # 按需修改配置
npm run build
npm start
```

生产入口是后端端口（默认 `49380`），前端静态文件由后端托管。

**部署到服务器时请确认：**

- `CODEX_BIN` 指向的 Codex CLI 可正常执行
- `DATA_DIR` 目录可写
- 防火墙已放行后端端口
- 如果需要局域网外访问，请配合反向代理、HTTPS 和额外的访问控制

---

## 安全

codex-web 内置了简单的本地密码登录，适合个人电脑、内网服务器或可信的局域网环境。

**它不适合直接暴露到公网。** 如果确实需要外网访问，建议：

- 使用反向代理（Nginx / Caddy 等）
- 启用 HTTPS
- 叠加额外的访问控制或 VPN

---

## 目录结构

```text
src/       后端服务、Codex 桥接、持久化和 API
web/       React 前端
themes/    内置主题
icons/     图标资源
config/    配置目录
```

---

## 贡献

欢迎提 Issue 和 PR。虽然这个项目起初是给自己用的，但如果你有好的想法或者发现了 bug，随时可以提。

---

## 致谢
- 项目由[CC-WEB](https://github.com/ZgDaniel/cc-web)启发
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Express](https://expressjs.com/)
- [Radix UI](https://www.radix-ui.com/)


---

## 协议

[MIT License](LICENSE)
