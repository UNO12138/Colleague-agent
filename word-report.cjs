const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = require('docx');

function runs(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part =>
    new TextRun({ text: part.startsWith('**') && part.endsWith('**') ? part.slice(2, -2) : part, bold: part.startsWith('**') && part.endsWith('**') })
  );
}

function tableCells(line) {
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function markdownToDocument(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const children = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      children.push(new Paragraph({ text: heading[2], heading: [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2][heading[1].length - 1], spacing: { before: heading[1].length === 1 ? 0 : 240, after: 120 } }));
      continue;
    }
    if (line.includes('|') && /^\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      const rows = [tableCells(line)];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) rows.push(tableCells(lines[index++]));
      index -= 1;
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((cells, rowIndex) => new TableRow({ children: cells.map(cell => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: rowIndex === 0 })] })] })) })) }));
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    children.push(new Paragraph({ children: runs(bullet ? bullet[1] : line), ...(bullet ? { bullet: { level: 0 } } : {}), spacing: { after: 120, line: 360 } }));
  }
  return new Document({ sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children }] });
}

async function saveWordReport(markdown, filePath) {
  const buffer = await Packer.toBuffer(markdownToDocument(markdown));
  await require('node:fs/promises').writeFile(filePath, buffer);
}

module.exports = { markdownToDocument, saveWordReport };
