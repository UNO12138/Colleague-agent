const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(projectRoot, 'release');
const target = path.join(releaseRoot, 'Alex-Colleague-Agent-Windows');
const appRoot = path.join(target, 'resources', 'app');
const electronBinary = require('electron');
const electronRoot = path.dirname(electronBinary);

if (!target.toLowerCase().startsWith((releaseRoot + path.sep).toLowerCase())) {
  throw new Error('打包目录超出发布目录');
}
fs.mkdirSync(releaseRoot, { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(electronRoot, target, { recursive: true });
fs.renameSync(path.join(target, 'electron.exe'), path.join(target, 'Alex Colleague Agent.exe'));
fs.mkdirSync(appRoot, { recursive: true });

const rootFiles = fs.readdirSync(projectRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && !entry.name.endsWith('.test.cjs') && /\.(?:html|js|cjs|css|svg|png|ps1)$/i.test(entry.name));
for (const entry of rootFiles) {
  fs.copyFileSync(path.join(projectRoot, entry.name), path.join(appRoot, entry.name));
}
for (const directory of ['assets', 'new-conversation', 'tools', 'prompts', 'scenario-archive']) {
  fs.cpSync(path.join(projectRoot, directory), path.join(appRoot, directory), { recursive: true });
}
fs.copyFileSync(path.join(projectRoot, 'set-dwm-border.ps1'), path.join(target, 'resources', 'set-dwm-border.ps1'));

const sourceManifest = require(path.join(projectRoot, 'package.json'));
fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: sourceManifest.description,
  main: 'main.cjs',
  dependencies: sourceManifest.dependencies
}, null, 2));

const copied = new Map();
function packageRootFor(dependency, requesterRoot) {
  const resolver = createRequire(path.join(requesterRoot, 'package.json'));
  let entry;
  try { entry = resolver.resolve(`${dependency}/package.json`); }
  catch { entry = resolver.resolve(dependency); }
  let candidate = path.dirname(entry);
  while (candidate !== path.dirname(candidate)) {
    const manifestPath = path.join(candidate, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === dependency) return { root: fs.realpathSync(candidate), manifest };
    }
    candidate = path.dirname(candidate);
  }
  throw new Error(`找不到运行依赖：${dependency}`);
}
function copyDependency(dependency, requesterRoot) {
  const { root, manifest } = packageRootFor(dependency, requesterRoot);
  const previous = copied.get(dependency);
  if (previous) {
    if (previous !== root) throw new Error(`发现多个版本的运行依赖：${dependency}`);
    return;
  }
  copied.set(dependency, root);
  const destination = path.join(appRoot, 'node_modules', ...dependency.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(root, destination, { recursive: true, dereference: true });
  for (const child of Object.keys(manifest.dependencies || {})) copyDependency(child, root);
}
for (const dependency of Object.keys(sourceManifest.dependencies || {})) copyDependency(dependency, projectRoot);

fs.writeFileSync(path.join(target, '使用说明.txt'), [
  'Alex Colleague Agent · Windows 便携版',
  '',
  '请先完整解压压缩包，再双击“Alex Colleague Agent.exe”。',
  '程序数据和密钥保存在当前 Windows 用户的数据目录，不包含打包者的私人配置。',
  'Codex 功能需要在本机另外安装 Codex 命令行并登录；无法连接时会在 30 秒内切换为明确标注的演示生成。',
  'DeepSeek 阶段生成功能需要在“工具 → Deepseek Harness → 配置接口”填写本机的接口密钥。',
  '周二汇报预设情境的离线对话和阶段界面存档已包含在程序内；这些存档不代表本机代理已执行任务。',
  '生成式界面仍属于原型，部分步骤与其他代理状态为演示。'
].join('\r\n'), 'utf8');

console.log(`已生成便携版目录：${target}`);
console.log(`运行依赖：${copied.size} 个`);
