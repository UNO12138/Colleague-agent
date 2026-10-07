const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('temporary API keeps key in memory and produces stages and Word content', async () => {
  const requests = [];
  const responses = [
    { kind: 'discussion', message: '本次回答' },
    { kind: 'plan_revision', message: '已加入预算', planSummary: '包含预算的新规划', taskCard: { title: '规划', statusText: '待确认', steps: ['梳理', '比较'] } },
    { kind: 'discussion', message: '请确认修改', changeSummary: '7天、12人、2名儿童、国庆出行、4间房', requirementsSummary: '7天；12人；2名儿童；国庆；4间房', planSummary: '已吸收条件的完整规划', taskCard: { title: '自驾路线', statusText: '按新条件排程', steps: [{ title: '分段路线' }, { name: '住宿安排' }] } },
    { summary: '阶段摘要', sections: [{ title: '发现', body: '这是当前步骤的内容。' }, { title: '建议', body: '下一步建议。' }] },
    { summary: '对比摘要', table: { columns: ['产品', '特点'], rows: [['A', '快速'], ['B', '稳定']] } },
    { summary: '耗时摘要', table: { columns: ['阶段', '分钟'], rows: [['设计', '20'], ['开发', '40']] } },
    { fileName: '产品分析报告.pdf', summary: '汇总产品比较和阶段发现。', sections: [
      { heading: '任务目标', body: '比较给定产品。' }, { heading: '阶段发现', body: '产品 A 快速，产品 B 稳定。' }
    ] }
  ];
  const context = {
    location: { origin: 'https://example.com' },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }) };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    window: {}
  };
  context.window.top = context.window;
  context.window.location = context.location;
  vm.runInNewContext(fs.readFileSync(require.resolve('./browser-api.js'), 'utf8'), context);
  const api = context.window.temporaryAiApi;
  api.setKey('test-key');
  assert.equal((await api.ask('本次问题')).message, '本次回答');
  const revision = await api.ask('再加上预算', 'plan_revision', { currentPlan: '旧规划', planningHistory: [
    { role: 'user', content: '先比较成本' }, { role: 'assistant', content: '已把成本加入分析重点' }
  ] });
  assert.equal(revision.planSummary, '包含预算的新规划');
  const change = await api.ask('请把条件写进主任务', 'task_message', {
    inputIntent: 'task_change', currentPlan: '汕尾到厦门自驾', currentRequirements: '7天',
    currentTaskCard: { title: '自驾路线', statusText: '核对里程', steps: ['分段路线', '住宿安排'] },
    recentUserInputs: ['去7天，三个家庭12人，两个小孩', '国庆，4间房']
  });
  assert.equal(change.kind, 'task_change');
  assert.equal(change.planSummary, '已吸收条件的完整规划');
  assert.match(change.changeSummary, /4间房/);
  assert.match(change.requirementsSummary, /12人/);
  assert.deepEqual(Array.from(change.taskCard.steps), ['分段路线', '住宿安排']);
  const stage = await api.generateStage({ conversationId: 'one', stepTitle: '步骤一', taskBrief: '任务说明' });
  assert.equal(stage.preview.previewType, 'document');
  assert.equal(stage.preview.previewData.template, 'summary');
  const comparison = await api.generateStage({ conversationId: 'one', stepTitle: '产品对比', taskBrief: '任务说明' });
  assert.equal(comparison.preview.previewData.template, 'comparison');
  assert.match(comparison.markdown, /\| 产品 \| 特点 \|/);
  const chart = await api.generateStage({ conversationId: 'one', stepTitle: '阶段耗时', taskBrief: '任务说明' });
  assert.equal(chart.preview.previewData.template, 'chart');
  assert.equal(api.listStages('one').length, 3);
  const deliverable = await api.generateFinal({ conversationId: 'one', title: '报告', taskBrief: '任务说明' });
  assert.equal(deliverable.wordDocument, true);
  assert.equal(deliverable.fileName, '产品分析报告.docx');
  assert.equal(deliverable.summary, '汇总产品比较和阶段发现。');
  assert.equal(deliverable.sections.length, 2);
  assert.equal('path' in deliverable, false);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content), {
    mode: 'task_message', message: '本次问题',
    taskContext: { currentPlan: '', currentStep: '', progress: '', taskStarted: false, inputIntent: '', currentTaskCard: {}, currentRequirements: '', recentUserInputs: [] }
  });
  assert.equal(requests[1].messages.length, 4);
  assert.equal(requests[1].messages[1].content, '先比较成本');
  assert.equal(requests[1].messages[2].content, '已把成本加入分析重点');
  assert.equal(JSON.parse(requests[1].messages[3].content).taskContext.currentPlan, '旧规划');
  assert.deepEqual(JSON.parse(requests[2].messages[1].content).taskContext.recentUserInputs, ['去7天，三个家庭12人，两个小孩', '国庆，4间房']);
  assert.equal(requests[6].messages[1].content.includes('这是当前步骤的内容'), true);
  api.clear();
  assert.equal(api.ready(), false);
  await assert.rejects(api.ask('再次提问'), /配置临时 API 密钥/);
});
