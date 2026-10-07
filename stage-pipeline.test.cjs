const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ARTIFACT_ROOT, createStageResult, parseMarkdownBlocks, safeLayout, visualData } = require('./stage-pipeline.cjs');

test('预设情境的阶段记录可从离线存档读取', async () => {
  const output = execFileSync(process.execPath, ['-e', "require('./stage-pipeline.cjs').listStageResults('weekly-report').then(value => console.log(JSON.stringify(value)))"], {
    cwd: __dirname,
    env: { ...process.env, COLLEAGUE_DATA_DIR: path.join(__dirname, 'missing-test-user-data') },
    encoding: 'utf8',
  });
  const archived = JSON.parse(output);
  const originalDirs = await fs.readdir(path.join(__dirname, 'scenario-archive'), { withFileTypes: true });
  assert.equal(originalDirs.filter(entry => entry.isDirectory()).length, 24);
  assert.equal(archived.length, 10);
  assert.ok(archived.some(result => result.stepTitle.includes('Linear') && result.preview?.previewType === 'document'));
  assert.ok(archived.some(result => result.stepTitle.includes('Miro') && result.preview?.previewType === 'document'));
});

test('Codex stage refuses a preview without successful command evidence', async () => {
  await assert.rejects(createStageResult({
    conversationId: 'missing-evidence',
    stepTitle: '统计文件数量',
    taskBrief: '统计当前目录的文件数量',
    sourceMarkdown: '# 统计结果\n\n当前目录有 12 个文件。',
    sourceEvidence: { provider: 'codex', threadId: 'thread', turnId: 'turn', commands: [] }
  }, { writer: () => { throw new Error('不应调用演示数据生成器'); } }), /缺少可核实的 Codex 取数证据/);
});

test('Codex stage accepts a recorded web search without a shell command', async () => {
  const result = await createStageResult({
    conversationId: 'web-evidence-test', stepTitle: '核查公开资料', taskBrief: '核查公开资料',
    sourceMarkdown: '# 公开资料\n\n来源：[官方说明](https://example.org/source)。网页搜索已核查该资料。',
    sourceEvidence: {
      provider: 'codex', model: 'gpt-5.6-luna', threadId: 'thread', turnId: 'turn', commands: [],
      webSearches: [{ id: 'search', type: 'webSearch', query: '官方说明', action: { type: 'search', query: '官方说明' } }]
    }
  }, { visualizer: async () => ({ template: 'summary', blockIds: [] }) });
  try { assert.equal(result.source.webSearchCount, 1); }
  finally { await fs.rm(path.join(ARTIFACT_ROOT, result.id), { recursive: true, force: true }); }
});

test('Codex stage passes other completed tool actions to the visual assistant', async () => {
  const action = { sequence: 1, type: 'mcpToolCall', detail: '{"result":"已读取 3 项"}' };
  const evidence = { provider: 'codex', model: 'gpt-5.6-luna', threadId: 'thread', turnId: 'turn', commands: [], actions: [action] };
  let received;
  const result = await createStageResult({
    conversationId: 'other-action-test', stepTitle: '整理工具结果', taskBrief: '整理工具结果',
    sourceMarkdown: '# 工具结果\n\n工具实际返回 3 项数据，当前阶段只整理这 3 项。', sourceEvidence: evidence
  }, { visualizer: async input => { received = input.sourceEvidence.actions; return { template: 'summary', blockIds: [] }; } });
  try { assert.deepEqual(received, [action]); assert.equal(result.source.actionCount, 1); }
  finally { await fs.rm(path.join(ARTIFACT_ROOT, result.id), { recursive: true, force: true }); }
});

test('30-second fallback is marked as unverified demo content', async () => {
  const result = await createStageResult({
    conversationId: 'codex-fallback-test', stepTitle: '整理当前步骤', taskBrief: '整理当前步骤',
    fallbackReason: 'Codex 在 30 秒内未返回行动', mainProcessData: { state: 'ready' }
  }, {
    writer: async () => '# 演示阶段\n\n当前尚未取得 Codex 的实际执行数据。本页面只展示任务阶段的演示内容，所有事实性结论仍待真实主代理核查，不应作为最终交付依据。',
    visualizer: async () => ({ template: 'summary', blockIds: [] })
  });
  try {
    assert.equal(result.source.provider, 'fallback-demo');
    assert.match(result.preview.previewData.note, /未经 Codex 实际执行核实/);
  } finally { await fs.rm(path.join(ARTIFACT_ROOT, result.id), { recursive: true, force: true }); }
});

test('Codex stage passes actual command evidence to the visual assistant', async () => {
  const evidence = {
    provider: 'codex', model: 'gpt-5.6-luna', threadId: 'thread', turnId: 'turn',
    commands: [{ id: 'command', command: 'count files', output: '文件数量：6；目录数量：2', exitCode: 0, status: 'completed' }]
  };
  let received;
  const result = await createStageResult({
    conversationId: 'evidence-test', stepTitle: '统计文件数量', taskBrief: '统计文件数量',
    sourceMarkdown: '# 文件统计\n\n| 项目 | 数量 |\n| --- | --- |\n| 文件 | 6 |\n| 目录 | 2 |\n\n命令实际输出为 6 个文件和 2 个目录。',
    sourceEvidence: evidence
  }, {
    writer: () => { throw new Error('不应改写 Codex 的阶段数据'); },
    visualizer: async input => { received = input.sourceEvidence; return { template: 'chart', blockIds: [] }; }
  });
  try {
    assert.equal(received, evidence);
    assert.equal(result.source.provider, 'codex');
    assert.equal(result.source.commandCount, 1);
    assert.equal(result.preview.previewData.chart.points[0].value, 6);
    const saved = JSON.parse(await fs.readFile(path.join(ARTIFACT_ROOT, result.id, 'codex-evidence.json'), 'utf8'));
    assert.equal(saved.commands[0].output, '文件数量：6；目录数量：2');
  } finally {
    await fs.rm(path.join(ARTIFACT_ROOT, result.id), { recursive: true, force: true });
  }
});

test('qualitative comparisons keep the source table as a matrix', () => {
  const blocks = parseMarkdownBlocks('# 比较\n\n| 产品 | 同步方式 | 证据 |\n| --- | --- | --- |\n| A | 实时 | 待核实 |\n| B | 异步 | 待核实 |');
  const layout = safeLayout({ template: 'summary', blockIds: [0] }, blocks);
  const data = visualData(blocks, layout);
  assert.equal(layout.template, 'comparison');
  assert.equal(data.blocks[1].kind, 'table');
  assert.deepEqual(data.blocks[1].rows[0], ['A', '实时', '待核实']);
  assert.equal(data.chart, null);
});

test('numeric two-column tables can become charts without changing values', () => {
  const blocks = parseMarkdownBlocks('# 阶段耗时\n\n| 阶段 | 分钟 |\n| --- | --- |\n| 调研 | 12 |\n| 设计 | 8 |');
  const data = visualData(blocks, safeLayout({ template: 'summary', blockIds: [] }, blocks));
  assert.equal(data.template, 'chart');
  assert.deepEqual(data.chart.points.map(point => [point.label, point.value, point.display]), [['调研', 12, '12'], ['设计', 8, '8']]);
});

test('mixed units and missing values never become a numeric chart', () => {
  const blocks = parseMarkdownBlocks('# 比较\n\n| 产品 | 数值 |\n| --- | --- |\n| A | 12% |\n| B | 8分钟 |\n| C |  |');
  assert.equal(safeLayout({ template: 'chart' }, blocks).template, 'comparison');
});

test('prose without a table cannot use a comparison matrix', () => {
  const blocks = parseMarkdownBlocks('# 分析\n\n## 观察\n\n这是一段观察。');
  assert.equal(safeLayout({ template: 'comparison' }, blocks).template, 'summary');
});

test('classified sections become cards even when the model requests a summary', () => {
  const blocks = parseMarkdownBlocks('# 分析\n\n## 用户价值\n\n减少查找时间。\n\n## 团队协作\n\n让交接状态清楚。\n\n## 使用成本\n\n需要学习新的入口。');
  const layout = safeLayout({ template: 'summary', blockIds: [0] }, blocks);
  const data = visualData(blocks, layout);
  assert.equal(layout.template, 'cards');
  assert.deepEqual(data.blocks.filter(block => block.kind === 'heading2').map(block => block.text), ['用户价值', '团队协作', '使用成本']);
  assert.deepEqual(data.blocks.filter(block => block.kind === 'paragraph').map(block => block.text), ['减少查找时间。', '让交接状态清楚。', '需要学习新的入口。']);
});

test('parallel bullet points become cards', () => {
  const blocks = parseMarkdownBlocks('# 洞察\n\n- 可以快速定位当前工作。\n- 可以回看阶段结果。\n- 可以看到等待用户决定的事项。');
  const data = visualData(blocks, safeLayout({ template: 'summary' }, blocks));
  assert.equal(data.template, 'cards');
  assert.equal(data.blocks.filter(block => block.kind === 'bullet').length, 3);
});

test('a single continuous observation remains a summary', () => {
  const blocks = parseMarkdownBlocks('# 观察\n\n这是一段连续的分析。');
  assert.equal(safeLayout({ template: 'summary' }, blocks).template, 'summary');
});
