# Colleague Agent

一个探索「主任务进度、协助代理交流与阶段性可视化」的网页和 Electron 桌面原型。当前重点是验证交互与界面；主进程编码代理的真实接入仍在设计阶段。

## 目前能体验什么

- **协作对话**：任务规划确认、工作卡片、步骤进度、需要用户决定的事项，以及侧栏中的项目与对话切换。
- **生成式 UI 阶段预览**：手动生成阶段 Markdown，再由视觉协助代理从七种固定版式中选择一种，以原文块为依据展示。可查看预览样例、重新生成草稿，并在本机恢复已保存的阶段结果。
- **最终文件演示**：结束模拟任务时，可根据阶段草稿生成 Word 报告；只有服务端返回实际文件路径后才显示交付文件卡。
- **工具页界面**：展示 Codex、Hermes Agent、Deepseek Harness 和 Kimi Code 的本地代理列表、搜索、状态按钮与管理弹窗。启动、连接、卸载、账户设置等目前只是界面演示，没有接入真实代理。
- **桌面窗口**：Electron 使用与网页相同的页面；各视图共用侧栏和毛玻璃窗口底层。

### 必须区分的事实

DeepSeek 会参与意图回复、阶段草稿和版式建议，但当前主任务步骤仍主要由原型情境和手动操作推进。提交给阶段生成的 `mainProcessData` 是页面可见文本及模拟状态的快照，**不是经核实的真实主 Agent 执行记录**。生成的内容不能直接视为已核查的外部事实。工具页显示的代理状态也是演示数据。

## 本地运行

需要 Node.js、pnpm 和可运行 Electron 的桌面环境。在本目录安装依赖：

```bash
pnpm install
```

| 目标 | 命令 | 说明 |
| --- | --- | --- |
| 只看网页界面 | `pnpm dev` | 打开 `http://127.0.0.1:5173/`；不启动本地模型适配层 |
| 网页与本地模型适配层 | `pnpm dev:demo` | 同时启动网页和 `http://127.0.0.1:8787` 上的适配层 |
| Electron 开发窗口 | `pnpm dev:desktop` | 同时启动网页开发服务和桌面窗口；窗口会启动本地适配层 |
| 单独启动桌面程序 | `pnpm start` | 直接加载本地页面；多视图开发与验收建议使用上一项 |

本项目同时保留 `package-lock.json` 和 `pnpm-lock.yaml`。以上命令以 pnpm 为例；请按所选包管理器的锁文件安装，避免混用导致依赖记录变化。`dev` 仅供本地预览，不会发布网站。

### 使用 DeepSeek 模型

在项目根目录创建不提交到 Git 的 `.env.local`：

```text
DEEPSEEK_API_KEY=你的密钥
```

本地适配层默认使用 `deepseek-v4-flash`；可用 `DEEPSEEK_MODEL` 覆盖，也可用 `COLLEAGUE_AGENT_PORT` 改端口。前端当前默认访问 `127.0.0.1:8787`，改端口时还需同步调整前端地址。Electron 启动时会尝试启动本地适配层；仅运行 `pnpm dev` 时，如需调用模型，应另开终端执行 `pnpm agent`，或直接使用 `pnpm dev:demo`。

密钥缺失或模型服务不可用时，意图交流可回退到本地规则；这只保障演示可继续，不代表模型判断成功。阶段草稿生成失败会显示错误和重试入口，不会伪装成真实生成结果。

## 生成式 UI 如何工作

1. 用户确认任务后，工作卡片显示当前步骤。点击「生成真实草稿」时，页面提交任务说明、步骤标题和当前界面快照。
2. 本地适配层调用 DeepSeek 生成阶段 Markdown，保存到被 Git 忽略的 `runtime-artifacts/`。
3. 服务端解析标题、段落、要点和表格。视觉协助代理只建议模板和原文块编号，服务端再校验并执行版式回退。
4. 前端通过固定组件展示摘要、分类卡片、对比矩阵、数字图表、环形图、流程或画布。布局模型不能直接生成任意网页代码。

分类内容优先卡片，非数字对比表使用矩阵；摘要只适合单一连续叙述。数量上限、图表判断和其他具体限定见[生成式 UI 范围与限定](./GENERATIVE_UI_CONSTRAINTS.md)。阶段原文、预览和最终文件是不同产物；预览可能只呈现部分原文内容。

## 当前未完成的部分

- 尚未接入 Codex 等真实主进程代理的会话、命令、文件变化、授权请求和执行事件。
- 阶段预览尚无逐条证据到原文及界面块的完整来源映射，也没有自动事实核查。
- 工具页的云端列表尚未设计完成；本地代理管理操作也未连接真实进程或账户。
- 本机阶段结果按会话和步骤标题恢复。步骤更名、清理运行目录或跨设备迁移后，当前不能保证恢复。
- 版式单元测试不能代替完整的端到端视觉与事实验收。

## 核心文件与文档

| 文件 | 用途 |
| --- | --- |
| [`index.html`](./index.html) | 协作对话、工作卡片与主界面 |
| [`tools/`](./tools/) | 工具页及管理弹窗界面 |
| [`new-conversation/`](./new-conversation/) | 新对话界面 |
| [`main.cjs`](./main.cjs) | Electron 窗口与本地适配层启动 |
| [`agent-server.cjs`](./agent-server.cjs) | DeepSeek 调用、本地接口与阶段生成入口 |
| [`stage-pipeline.cjs`](./stage-pipeline.cjs) | 阶段原文解析、版式约束、保存与报告生成 |
| [`step-preview.js`](./step-preview.js) | 固定的阶段预览组件 |
| [`GENERATIVE_UI_CONSTRAINTS.md`](./GENERATIVE_UI_CONSTRAINTS.md) | 生成式 UI 的范围、版式规则与数量限制 |
| [`GENERATIVE_UI_STAGE_REVIEW.md`](./GENERATIVE_UI_STAGE_REVIEW.md) | 阶段性核验记录与后续对接事项 |
| [`MAIN_AGENT_UI_SPEC.md`](./MAIN_AGENT_UI_SPEC.md) | 真实代理接入前的界面预留清单 |
| [`MAIN_AGENT_INTEGRATION_ARCHITECTURE.md`](./MAIN_AGENT_INTEGRATION_ARCHITECTURE.md) | 多种编码代理的后续接入草案 |
| [`STATE_AND_UI_SPEC.md`](./STATE_AND_UI_SPEC.md) | 协作状态与界面分支规格 |
| [`ASSISTANT_AGENT_SPEC.md`](./ASSISTANT_AGENT_SPEC.md) | 协助代理的职责和输入输出约定 |

## 本地验证

```bash
node --test stage-pipeline.test.cjs file-artifact.test.cjs
```

测试覆盖部分版式回退、分类卡片、数字表格与交付文件状态。运行结果仅证明这些用例通过；真实主 Agent 执行和外部资料准确性需要独立验证。
