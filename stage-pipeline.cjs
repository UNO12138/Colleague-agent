const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { makeArtifactFileName } = require('./file-artifact.js');
const { saveWordReport } = require('./word-report.cjs');

const DATA_ROOT = process.env.COLLEAGUE_DATA_DIR || __dirname;
const ARTIFACT_ROOT = path.join(DATA_ROOT, 'runtime-artifacts');
const SCENARIO_ARCHIVE_ROOT = path.join(__dirname, 'scenario-archive');
const PREVIEW_SCHEMA_VERSION = 2;
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function numericSeries(table) {
  if (!table || table.kind !== 'table' || table.columns.length < 2 || table.rows.length < 2) return null;
  const points = [];
  for (const row of table.rows) {
    for (let index = 1; index < table.columns.length; index += 1) {
      const match = String(row[index]).match(/^(\d+(?:\.\d+)?)\s*(%|[a-zA-Z\u4e00-\u9fff]*)$/);
      if (!match) return null;
      points.push({
        label: table.columns.length === 2 ? row[0] : `${row[0]} · ${table.columns[index]}`,
        value: Number(match[1]),
        display: row[index],
        unit: match[2]
      });
    }
  }
  if (points.some(point => !point || !Number.isFinite(point.value)) || new Set(points.map(point => point.unit)).size !== 1) return null;
  const isComposition = table.columns.length === 2
    && points.length <= 6
    && points[0]?.unit === '%'
    && Math.abs(points.reduce((sum, point) => sum + point.value, 0) - 100) <= 1;
  return { labelHeader: table.columns[0], valueHeader: table.columns.slice(1).join(' / '), points: points.slice(0, 10), isComposition };
}

function parseMarkdownBlocks(markdown) {
  const plainText = value => value.replace(/^>\s?/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  const blocks = [];
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ id: blocks.length, kind: 'paragraph', text: plainText(paragraph.join(' ').trim()) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = line.trim();
    if (!text) { flush(); continue; }
    const columns = tableCells(text);
    const divider = tableCells(lines[index + 1] || '');
    if (columns && columns.every(Boolean) && divider && divider.length === columns.length && divider.every(cell => /^:?-{3,}:?$/.test(cell))) {
      flush();
      const rows = [];
      index += 2;
      while (index < lines.length) {
        const row = tableCells(lines[index]);
        if (!row || row.length !== columns.length) break;
        rows.push(row.map(plainText));
        index += 1;
      }
      if (rows.length) blocks.push({ id: blocks.length, kind: 'table', columns: columns.map(plainText), rows: rows.slice(0, 12) });
      index -= 1;
      continue;
    }
    const heading = text.match(/^(#{1,3})\s+(.+)$/);
    const bullet = text.match(/^[-*]\s+(.+)$/);
    if (heading || bullet) {
      flush();
      blocks.push({ id: blocks.length, kind: heading ? `heading${heading[1].length}` : 'bullet', text: plainText((heading ? heading[2] : bullet[1]).trim()) });
    } else {
      paragraph.push(text);
    }
  }
  flush();
  return blocks.filter(block => block.text || block.kind === 'table').slice(0, 40);
}

function safeLayout(raw, blocks) {
  const table = blocks.find(block => block.kind === 'table');
  const numeric = numericSeries(table);
  const sectionCount = blocks.filter(block => ['heading2', 'heading3'].includes(block.kind)).length;
  const bulletCount = blocks.filter(block => block.kind === 'bullet').length;
  const hasCategories = sectionCount >= 2 || (sectionCount === 0 && bulletCount >= 2);
  const allowedTemplates = new Set(['summary', 'cards', 'comparison', 'chart', 'donut', 'workflow', 'canvas']);
  const requested = allowedTemplates.has(raw?.template) ? raw.template : null;
  let template = requested || (hasCategories ? 'cards' : 'summary');
  if (numeric) template = numeric.isComposition ? 'donut' : 'chart';
  else if (table) template = 'comparison';
  else if (['comparison', 'chart', 'donut'].includes(template)) template = hasCategories ? 'cards' : 'summary';
  else if (hasCategories && template === 'summary') template = 'cards';
  const allowed = new Set(blocks.map(block => block.id));
  let selected = Array.isArray(raw?.blockIds)
    ? [...new Set(raw.blockIds.filter(id => Number.isInteger(id) && allowed.has(id)))].slice(0, 7)
    : [];
  if (table) {
    const title = blocks.find(block => block.kind === 'heading1');
    selected = [title?.id, table.id].filter(id => id !== undefined);
  } else if (template === 'cards') {
    const title = blocks.find(block => block.kind === 'heading1');
    const sectionHeads = blocks.filter(block => ['heading2', 'heading3'].includes(block.kind));
    if (sectionHeads.length >= 2) {
      selected = [title?.id].filter(id => id !== undefined);
      for (const heading of sectionHeads.slice(0, 3)) {
        selected.push(heading.id);
        const nextHeading = blocks.find(block => block.id > heading.id && ['heading2', 'heading3'].includes(block.kind));
        selected.push(...blocks.filter(block => block.id > heading.id && (!nextHeading || block.id < nextHeading.id) && ['paragraph', 'bullet'].includes(block.kind)).slice(0, 1).map(block => block.id));
      }
    } else if (bulletCount >= 2) {
      selected = [title?.id, ...blocks.filter(block => block.kind === 'bullet').slice(0, 6).map(block => block.id)].filter(id => id !== undefined);
    }
  }
  if (!selected.length) selected.push(...blocks.slice(0, 7).map(block => block.id));
  return { template, blockIds: selected };
}

function visualData(blocks, layout, note = '由协作 Agent 从主进程阶段结果中抽取并重组；缺失字段不会作为占位内容显示。') {
  const byId = new Map(blocks.map(block => [block.id, block]));
  return {
    template: layout.template,
    blocks: layout.blockIds.map(id => byId.get(id)).filter(Boolean).map(block => block.kind === 'table'
      ? { kind: 'table', columns: block.columns, rows: block.rows }
      : { kind: block.kind, text: block.text }),
    chart: ['chart', 'donut'].includes(layout.template) ? numericSeries(blocks.find(block => block.kind === 'table')) : null,
    note
  };
}

async function createStageResult(input, agents) {
  const conversationId = String(input.conversationId || 'local').slice(0, 100);
  const stepTitle = String(input.stepTitle || '当前步骤').slice(0, 160);
  const taskBrief = String(input.taskBrief || '').trim().slice(0, 4000);
  const mainProcessData = input.mainProcessData && typeof input.mainProcessData === 'object'
    ? JSON.stringify(input.mainProcessData).slice(0, 8000)
    : '{"state":"ready"}';
  if (!taskBrief) throw new Error('缺少任务说明');
  const evidence = input.sourceEvidence;
  const fromCodex = evidence?.provider === 'codex';
  const fallbackReason = String(input.fallbackReason || '').slice(0, 300);
  if (fromCodex && (!evidence.threadId || !evidence.turnId || !Array.isArray(evidence.commands)
    || !(evidence.commands.some(command => command.status === 'completed' && command.exitCode === 0 && String(command.output || '').trim())
      || evidence.webSearches?.some(item => item.action?.type === 'search')
      || evidence.actions?.some(item => item.detail && ['mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall'].includes(item.type))))) {
    throw new Error('缺少可核实的 Codex 取数证据');
  }
  const markdown = String(fromCodex ? input.sourceMarkdown : await agents.writer({ taskBrief, stepTitle, mainProcessData })).trim();
  if (markdown.length < (fromCodex ? 30 : 60) || markdown.length > 12000) throw new Error('主 Agent 未生成有效的阶段文本');
  const id = crypto.randomUUID();
  const artifactDir = path.join(ARTIFACT_ROOT, id);
  const fileName = makeArtifactFileName(stepTitle, 'md', '阶段草稿');
  const markdownPath = path.join('runtime-artifacts', id, fileName).replace(/\\/g, '/');
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, fileName), `${markdown}\n`, 'utf8');
  const evidencePath = fromCodex ? path.join('runtime-artifacts', id, 'codex-evidence.json').replace(/\\/g, '/') : null;
  if (fromCodex) await fs.writeFile(path.join(artifactDir, 'codex-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');

  const blocks = parseMarkdownBlocks(markdown);
  let layoutInput = {};
  let renderedBy = 'fallback';
  try {
    layoutInput = await agents.visualizer({ blocks, stepTitle, sourceEvidence: fromCodex ? evidence : null });
    renderedBy = 'visual-assistant';
  } catch (error) {
    renderedBy = `fallback: ${String(error.message || '视觉助手不可用').slice(0, 120)}`;
  }
  const layout = safeLayout(layoutInput, blocks);
  await fs.writeFile(path.join(artifactDir, 'visual-layout.json'), JSON.stringify(layout, null, 2), 'utf8');

  const firstParagraph = blocks.find((block, index) => block.kind === 'paragraph' && blocks.slice(0, index).some(previous => previous.kind === 'heading2'))?.text
    || blocks.find(block => block.kind === 'paragraph')?.text || blocks[0]?.text || '';
  const firstSentence = firstParagraph.split('。')[0].trim();
  const result = {
    previewSchemaVersion: PREVIEW_SCHEMA_VERSION,
    id,
    conversationId,
    stepTitle,
    createdAt: new Date().toISOString(),
    markdownPath,
    source: fromCodex ? {
      provider: 'codex', model: evidence.model, threadId: evidence.threadId,
      turnId: evidence.turnId, commandCount: evidence.commands.length,
      actionCount: evidence.actions?.length || evidence.commands.length,
      webSearchCount: evidence.webSearches?.filter(item => item.action?.type === 'search').length || 0,
      evidencePath
    } : { provider: fallbackReason ? 'fallback-demo' : 'demo', evidencePath: null, ...(fallbackReason ? { reason: fallbackReason } : {}) },
    visualLayoutPath: path.join('runtime-artifacts', id, 'visual-layout.json').replace(/\\/g, '/'),
    renderedBy,
    preview: {
      status: 'active',
      title: stepTitle,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      summary: `${firstSentence.slice(0, 90)}${firstSentence ? '。' : ''}`,
      previewType: 'document',
      artifactState: 'available',
      previewData: visualData(blocks, layout, fromCodex
        ? `依据 Codex 实际取数结果排版 · ${evidence.actions?.length || evidence.commands.length} 项行动 · 证据已保存`
        : fallbackReason
          ? 'Codex 未及时返回行动；已切换为演示生成，内容未经 Codex 实际执行核实。'
          : '演示阶段内容；尚未接入真实主 Agent 执行记录。')
    }
  };
  await fs.writeFile(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

async function listStageResults(conversationId) {
  const target = String(conversationId || '').slice(0, 100);
  if (!target) return [];
  async function readFrom(root, dataRoot) {
    let dirs;
    try { dirs = await fs.readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(dirs.filter(dir => dir.isDirectory()).slice(-100).map(async dir => {
    try {
      const result = JSON.parse(await fs.readFile(path.join(root, dir.name, 'result.json'), 'utf8'));
      const savedFile = path.resolve(dataRoot, result.markdownPath || '');
      if (!savedFile.startsWith(`${root}${path.sep}`)) return null;
      await fs.access(savedFile);
      return result.previewSchemaVersion === PREVIEW_SCHEMA_VERSION ? result : null;
    }
    catch { return null; }
    }));
  }
  const current = await readFrom(ARTIFACT_ROOT, DATA_ROOT);
  const archived = target === 'weekly-report' ? await readFrom(SCENARIO_ARCHIVE_ROOT, __dirname) : [];
  const byId = new Map(archived.filter(Boolean).map(result => [result.id, result]));
  for (const result of current.filter(Boolean)) byId.set(result.id, result);
  return [...byId.values()].filter(result => result.conversationId === target)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createFinalResult(input, writer) {
  const conversationId = String(input.conversationId || '').slice(0, 100);
  const taskBrief = String(input.taskBrief || '').trim().slice(0, 4000);
  const title = String(input.title || '任务报告').slice(0, 80);
  if (!conversationId || !taskBrief) throw new Error('缺少任务说明或会话标识');
  const stages = await listStageResults(conversationId);
  const source = (await Promise.all(stages.slice(0, 8).reverse().map(async stage =>
    `阶段：${stage.stepTitle}\n${(await fs.readFile(path.join(stage.archiveKind === 'offline-scenario' ? __dirname : DATA_ROOT, stage.markdownPath), 'utf8')).slice(0, 5000)}`
  ))).join('\n\n');
  const markdown = String(await writer({ taskBrief, title, source })).trim();
  if (markdown.length < 100 || markdown.length > 30000) throw new Error('未生成有效的最终文档');
  const id = crypto.randomUUID();
  const artifactDir = path.join(ARTIFACT_ROOT, id);
  const fileName = makeArtifactFileName(title, 'docx', '案例报告');
  await fs.mkdir(artifactDir, { recursive: true });
  await saveWordReport(markdown, path.join(artifactDir, fileName));
  const artifactPath = path.join('runtime-artifacts', id, fileName).replace(/\\/g, '/');
  await fs.writeFile(path.join(artifactDir, 'final-result.json'), JSON.stringify({ conversationId, artifactPath, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return { artifactState: 'available', path: artifactPath, summary: '案例报告已生成。未核实的信息已在文档中标注。' };
}

module.exports = { createStageResult, listStageResults, createFinalResult, parseMarkdownBlocks, safeLayout, visualData, numericSeries, ARTIFACT_ROOT };
