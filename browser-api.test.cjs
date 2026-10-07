const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('temporary API keeps key in memory and produces stage and report drafts', async () => {
  const requests = [];
  const responses = [
    { kind: 'discussion', message: '本次回答' },
    { summary: '阶段摘要', sections: [{ title: '发现', body: '这是当前步骤的内容。' }, { title: '建议', body: '下一步建议。' }] },
    { markdown: '# 报告草稿\n\n' + '正文。'.repeat(40) }
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
  const stage = await api.generateStage({ conversationId: 'one', stepTitle: '步骤一', taskBrief: '任务说明' });
  assert.equal(stage.preview.previewType, 'document');
  assert.equal(api.listStages('one').length, 1);
  assert.match(await api.generateFinal({ conversationId: 'one', title: '报告', taskBrief: '任务说明' }), /报告草稿/);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content), {
    mode: 'task_message', message: '本次问题',
    taskContext: { currentPlan: '', currentStep: '', progress: '', taskStarted: false, inputIntent: '' }
  });
  assert.equal(requests[2].messages[1].content.includes('这是当前步骤的内容'), true);
  api.clear();
  assert.equal(api.ready(), false);
  await assert.rejects(api.ask('再次提问'), /配置临时 API 密钥/);
});
