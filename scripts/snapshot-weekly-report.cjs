const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'runtime-artifacts');
const archiveRoot = path.join(projectRoot, 'scenario-archive');
if (path.dirname(archiveRoot) !== projectRoot || path.basename(archiveRoot) !== 'scenario-archive') {
  throw new Error('情境存档目录不在项目内');
}
if (!fs.existsSync(sourceRoot)) throw new Error('找不到原有阶段记录');
fs.rmSync(archiveRoot, { recursive: true, force: true });
fs.mkdirSync(archiveRoot);

const records = [];
for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name)) continue;
  const sourceDir = path.join(sourceRoot, entry.name);
  const resultFile = path.join(sourceDir, 'result.json');
  if (!fs.existsSync(resultFile)) continue;
  const original = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (original.conversationId !== 'weekly-report') continue;
  const markdownName = path.basename(original.markdownPath || '');
  if (!markdownName || !fs.existsSync(path.join(sourceDir, markdownName))) continue;
  const targetDir = path.join(archiveRoot, entry.name);
  fs.mkdirSync(targetDir);
  fs.copyFileSync(path.join(sourceDir, markdownName), path.join(targetDir, markdownName));
  if (fs.existsSync(path.join(sourceDir, 'visual-layout.json'))) {
    fs.copyFileSync(path.join(sourceDir, 'visual-layout.json'), path.join(targetDir, 'visual-layout.json'));
  }
  const result = {
    ...original,
    markdownPath: `scenario-archive/${entry.name}/${markdownName}`,
    visualLayoutPath: `scenario-archive/${entry.name}/visual-layout.json`,
    archiveKind: 'offline-scenario',
  };
  fs.writeFileSync(path.join(targetDir, 'result.json'), JSON.stringify(result, null, 2));
  if (result.previewSchemaVersion === 2) records.push(result);
}
records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
fs.writeFileSync(path.join(archiveRoot, 'records.js'), `window.OfflineScenarioRecords = Object.freeze(${JSON.stringify(records)});\n`);
fs.writeFileSync(path.join(archiveRoot, 'README.md'), [
  '# 预设情境的离线阶段记录',
  '',
  '这里仅保存“周二汇报”预设情境以前生成的阶段草稿和生成式界面记录。',
  '它们是演示存档，不表示接收设备上的主 Agent 已执行或核实这些内容。',
  '新建对话、接口密钥和其他任务的私人产物不会进入便携版。',
  '',
  `原始阶段记录：${fs.readdirSync(archiveRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length} 条；当前界面兼容并可直接显示：${records.length} 条。`,
  '',
].join('\n'));
console.log(`已保存 ${records.length} 条预设情境阶段记录`);
