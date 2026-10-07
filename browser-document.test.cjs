const test = require('node:test');
const assert = require('node:assert/strict');
const { createWordBlob } = require('./browser-document.js');
const docx = require('docx');

test('browser document creates an actual Word file from report content', async () => {
  const blob = await createWordBlob({
    wordDocument: true, title: '产品分析报告', summary: '阶段分析摘要',
    sections: [
      { heading: '任务目标', body: '比较产品 A 与产品 B。' },
      { heading: '阶段发现', body: '产品 A 快速。\n产品 B 稳定。' }
    ]
  }, docx);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(blob.size > 1000);
  const bytes = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  assert.deepEqual([...bytes], [0x50, 0x4b]);
});
