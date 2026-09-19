# Colleague Agent

这是一个用于展示「主任务与协作 Agent 即时交流」关系的交互原型。

## 当前 MVP

- 以工作卡片呈现主任务进度，并在滚动时置顶。
- 将不改变主任务的即时交流收纳在工作卡片下方。
- 对会改变主任务的交流提供确认卡片；确认后同步到工作进度。
- 支持侧栏收起、输入框 Enter 发送、工作状态与进度联动。

## 网页预览与桌面窗口

首次运行先在本目录执行 `npm install`。运行 `npm run dev`，然后访问 `http://127.0.0.1:5173/`。它会监听文件改动并实时刷新网页；网页仍是独立的静态页面，可以部署后通过链接分享。

需要测试 DeepSeek API Agent 时，先在项目根目录创建不会提交到 Git 的 `.env.local`：

```text
DEEPSEEK_API_KEY=你的密钥
```

然后使用：

```bash
npm run dev:demo
```

这会同时启动 Vite 和 `http://127.0.0.1:8787` 上的本地 Agent 适配层。适配层调用 DeepSeek 官方 API，默认使用 `deepseek-flash`，并要求结构化 JSON 输出。目前覆盖三条演示链路：规划确认前的修改、执行中的任务变更识别，以及需要用户确认的决策请求。模型只负责识别意图并生成界面数据，不会执行工具或修改本地文件。

如果 DeepSeek 在 15 秒内没有响应，前端会自动切换到本地关键词规则，继续完成交互演示，并在模型名称旁显示“规则回退”。这个回退只用于保证原型可测试，不代表真实模型判断结果。

Electron 桌面窗口使用同一份 `index.html`：

```bash
npm start
```

开发时请用下面这条命令。它会同时启动本地开发服务与 Electron，保存 `index.html`、SVG 等文件后窗口会自动更新，无需关闭重开：

```bash
npm run dev:desktop
```

项目目前使用 npm 锁文件。若改用 pnpm，请先用 pnpm 安装依赖，再运行 `pnpm dev`（网页）或 `pnpm dev:desktop`（桌面）。`dev` 只运行本地预览，不会自动发布到线上。

## 文件说明

- `index.html`：单文件可交互原型。
- `main.cjs`：Electron 窗口入口。
- `agent-server.cjs`：浏览器与 DeepSeek API 之间的轻量适配层。
- `agent-response.schema.json`：模型返回给原型的结构化输出协议。
- `STATE_AND_UI_SPEC.md`：已确认的状态、界面分支与当前原型缺口。
- `ASSISTANT_AGENT_SPEC.md`：协助 Agent 的输入输出约定、语言原则和首轮调校用例。
- `figma-sidebar-toggle.svg`：侧栏收起按钮图标。
- `figma-window-controls.svg`：窗口控制图标组。
