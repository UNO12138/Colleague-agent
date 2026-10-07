(() => {
  async function createWordBlob(value, library = typeof docx !== 'undefined' ? docx : null) {
    if (!library || !value?.wordDocument || !Array.isArray(value.sections) || value.sections.length < 2) {
      throw new Error('Word 文档内容不完整');
    }
    const { Document, Paragraph, TextRun, HeadingLevel, Packer } = library;
    const children = [
      new Paragraph({ text: String(value.title || '任务报告'), heading: HeadingLevel.TITLE, spacing: { after: 280 } }),
      new Paragraph({ children: [new TextRun({ text: String(value.summary || ''), italics: true })], spacing: { after: 320 } })
    ];
    for (const section of value.sections) {
      children.push(new Paragraph({ text: String(section.heading), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 } }));
      for (const line of String(section.body).split(/\n+/).map(item => item.trim()).filter(Boolean)) {
        children.push(new Paragraph({ text: line, spacing: { after: 140 }, lineSpacing: 1.35 }));
      }
    }
    const document = new Document({
      styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
      sections: [{ properties: {}, children }]
    });
    return Packer.toBlob(document);
  }

  const api = Object.freeze({ createWordBlob });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BrowserDocument = api;
})();
