const test = require('node:test');
const assert = require('node:assert/strict');
const { makeArtifactFileName, normalizeFileArtifact, normalizeFilePreview } = require('../file-artifact.js');

test('file icons and labels follow the saved file extension', () => {
  const expected = [
    ['report.docx', 'word', 'Word 文档'],
    ['report.pdf', 'pdf', 'PDF 文档'],
    ['data.xlsx', 'sheet', 'Excel 工作簿'],
    ['slides.pptx', 'slides', 'PowerPoint 演示文稿'],
    ['draft.md', 'markdown', 'Markdown 文档'],
    ['preview.png', 'image', '图片'],
    ['index.html', 'code', 'HTML 页面']
  ];
  for (const [fileName, kind, fileType] of expected) {
    const actual = normalizeFileArtifact({ artifactState: 'available', path: `results/${fileName}`, fileType: '伪造类型' });
    assert.equal(actual.kind, kind);
    assert.equal(actual.fileType, fileType);
    assert.equal(actual.fileName, fileName);
  }
});

test('pending or pathless results do not appear as completed files', () => {
  assert.equal(normalizeFileArtifact({ artifactState: 'pending', path: 'results/report.docx' }), null);
  assert.equal(normalizeFileArtifact({ artifactState: 'available', fileName: 'report.docx' }), null);
});

test('generated names are specific and Windows-safe', () => {
  assert.equal(makeArtifactFileName('Linear · 状态/协作', 'md', '阶段草稿'), 'Linear-状态-协作-阶段草稿.md');
  assert.equal(makeArtifactFileName('CON', '.pdf'), '任务-CON.pdf');
});

test('display-only file preview uses the same file type without a path', () => {
  assert.deepEqual(normalizeFilePreview({ displayOnly: true, fileName: '分析报告.pdf' }), {
    fileName: '分析报告.pdf', extension: 'pdf', kind: 'pdf', fileType: 'PDF 文档', glyph: 'PDF'
  });
  assert.equal(normalizeFilePreview({ displayOnly: true, fileName: '分析报告.pdf', path: '/fake/report.pdf' }), null);
  assert.equal(normalizeFilePreview({ displayOnly: true, fileName: '../分析报告.pdf' }), null);
});
