const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdownBlocks, safeLayout, visualData } = require('./stage-pipeline.cjs');

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
