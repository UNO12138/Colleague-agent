# Colleague Agent

这是一个用于展示「主任务与协作 Agent 即时交流」关系的交互原型。

## 当前 MVP

- 以工作卡片呈现主任务进度，并在滚动时置顶。
- 将不改变主任务的即时交流收纳在工作卡片下方。
- 对会改变主任务的交流提供确认卡片；确认后同步到工作进度。
- 支持侧栏收起、输入框 Enter 发送、工作状态与进度联动。

## 本地预览

在本目录运行：

```bash
python -m http.server 4173
```

然后访问 `http://127.0.0.1:4173/`。

## 文件说明

- `index.html`：单文件可交互原型。
- `figma-sidebar-toggle.svg`：侧栏收起按钮图标。
- `figma-window-controls.svg`：窗口控制图标组。

