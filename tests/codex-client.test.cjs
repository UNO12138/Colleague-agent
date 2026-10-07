const test = require('node:test');
const assert = require('node:assert/strict');
const { CodexClient } = require('../codex-client.cjs');

test('completed observable actions are returned in order', () => {
  const client = new CodexClient();
  const received = [];
  const turn = {
    text: '', completedText: '', events: [], onAction: action => received.push(action),
    timer: setTimeout(() => {}, 1000), resolve: () => {}, reject: () => {}
  };
  client.activeTurns.set('turn', turn);
  client.handleMessage({ method: 'item/completed', params: {
    turnId: 'turn', item: { id: 'one', type: 'mcpToolCall', status: 'completed', result: { count: 3 } }
  } });
  client.handleMessage({ method: 'item/completed', params: {
    turnId: 'turn', item: { id: 'two', type: 'webSearch', query: '来源', action: { type: 'search', query: '来源' } }
  } });
  client.handleMessage({ method: 'item/completed', params: {
    turnId: 'turn', item: { id: 'three', type: 'reasoning', summary: '不可外传' }
  } });
  clearTimeout(turn.timer);
  assert.deepEqual(received.map(action => action.type), ['mcpToolCall', 'webSearch']);
  assert.equal(JSON.parse(received[0].detail).result.count, 3);
  assert.equal(turn.events.length, 2);
});

test('first-action deadline interrupts a stalled turn', async () => {
  const client = new CodexClient();
  client.start = async () => {};
  client.knownThreads.add('thread');
  const calls = [];
  client.request = async method => {
    calls.push(method);
    if (method === 'turn/start') return { turn: { id: 'turn' } };
    return {};
  };
  await assert.rejects(client.run({
    threadId: 'thread', prompt: '读取数据', firstActionTimeoutMs: 20, timeoutMs: 200
  }), /30 秒内未返回行动/);
  assert.ok(calls.includes('turn/interrupt'));
  assert.equal(client.activeTurns.size, 0);
});
