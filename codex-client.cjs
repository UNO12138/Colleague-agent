const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const MODEL = 'gpt-5.6-luna';
const CWD = path.resolve(process.env.COLLEAGUE_DATA_DIR || __dirname);
const TURN_TIMEOUT_MS = 90000;

function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.platform === 'win32') {
    const lines = execFileSync('where.exe', ['codex'], { encoding: 'utf8' }).trim().split(/\r?\n/);
    return lines.find(line => line.toLowerCase().endsWith('codex.exe')) || lines[0];
  }
  return 'codex';
}

class CodexClient {
  constructor() {
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.activeTurns = new Map();
    this.knownThreads = new Set();
    this.starting = null;
    this.buffer = '';
    this.stderr = '';
  }

  async start() {
    if (this.process && !this.process.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = null; }
  }

  async launch() {
    const binary = findCodex();
    const child = spawn(binary, ['app-server', '-c', 'service_tier="fast"'], {
      cwd: CWD,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });
    this.process = child;
    this.buffer = '';
    this.stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.readOutput(chunk));
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-2000); });
    child.on('error', error => this.failAll(error));
    child.on('exit', code => this.failAll(new Error(`Codex 服务已退出（${code}）：${this.stderr.trim()}`)));
    try {
      await this.request('initialize', {
        clientInfo: { name: 'colleague-agent', title: 'Colleague Agent', version: '0.1.0' },
        capabilities: null
      }, 15000);
      this.send({ method: 'initialized' });
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  failAll(error) {
    this.process = null;
    this.knownThreads.clear();
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    for (const entry of this.activeTurns.values()) { clearTimeout(entry.timer); clearTimeout(entry.firstActionTimer); entry.reject(error); }
    this.pending.clear();
    this.activeTurns.clear();
  }

  send(message) {
    if (!this.process?.stdin?.writable) throw new Error('Codex 服务未启动');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} 等待超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  readOutput(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const raw = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!raw) continue;
      try { this.handleMessage(JSON.parse(raw)); }
      catch { /* Ignore non-protocol diagnostics on stdout. */ }
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || 'Codex 请求失败'));
      else entry.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: '此界面尚不支持交互式批准' } });
      return;
    }
    const params = message.params || {};
    const turn = this.activeTurns.get(params.turnId || params.turn?.id);
    if (!turn) return;
    if (message.method === 'item/agentMessage/delta') turn.text += params.delta || '';
    if (message.method === 'item/started' && params.item) {
      if (params.item.type === 'commandExecution') turn.onProgress?.('正在读取本地数据');
      if (params.item.type === 'webSearch') turn.onProgress?.('正在搜索公开来源');
    }
    if (message.method === 'item/completed' && params.item) {
      const item = params.item;
      if (item.type === 'agentMessage' && item.text) turn.completedText = item.text;
      let action = null;
      if (item.type === 'commandExecution') {
        action = {
          id: item.id, type: item.type, command: item.command,
          cwd: item.cwd, output: item.aggregatedOutput || '',
          exitCode: item.exitCode, status: item.status
        };
      }
      if (item.type === 'webSearch') {
        action = { id: item.id, type: item.type, query: item.query, action: item.action };
      }
      if (item.type === 'fileChange') {
        action = { id: item.id, type: item.type, status: item.status, changes: item.changes };
      }
      if (!action && !['agentMessage', 'reasoning', 'userMessage', 'hookPrompt'].includes(item.type)) {
        action = { id: item.id, type: item.type, status: item.status || 'completed', detail: JSON.stringify(item).slice(0, 8000) };
      }
      if (action) {
        turn.events.push(action);
        turn.onAction?.(action);
        turn.onProgress?.(`已完成 ${turn.events.length} 项操作`);
      }
    }
    if (message.method === 'turn/completed') {
      clearTimeout(turn.timer);
      clearTimeout(turn.firstActionTimer);
      this.activeTurns.delete(params.turn.id);
      if (params.turn.status === 'completed') turn.resolve({ text: turn.completedText || turn.text, events: turn.events });
      else turn.reject(new Error(params.turn.error?.message || `Codex 回合${params.turn.status}`));
    }
  }

  async run({ threadId, prompt, onProgress, onAction, timeoutMs = TURN_TIMEOUT_MS, firstActionTimeoutMs = 0 }) {
    const runStartedAt = Date.now();
    const connectionWait = () => firstActionTimeoutMs
      ? Math.max(1, firstActionTimeoutMs - (Date.now() - runStartedAt)) : 20000;
    await this.start();
    if (firstActionTimeoutMs && connectionWait() <= 1) throw new Error('Codex 在 30 秒内未连接');
    onProgress?.('Codex 已连接，正在准备任务');
    if (threadId && !this.knownThreads.has(threadId)) {
      await this.request('thread/resume', {
        threadId, model: MODEL, cwd: CWD, approvalPolicy: 'never', sandbox: 'read-only',
        config: { web_search: 'live' }, persistExtendedHistory: false
      }, connectionWait());
      this.knownThreads.add(threadId);
    }
    if (!threadId) {
      const response = await this.request('thread/start', {
        model: MODEL, cwd: CWD, approvalPolicy: 'never', sandbox: 'read-only',
        config: { web_search: 'live' }, experimentalRawEvents: false, persistExtendedHistory: false
      }, connectionWait());
      threadId = response.thread.id;
      this.knownThreads.add(threadId);
    }
    const started = await this.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
      model: MODEL, effort: 'low'
    }, connectionWait());
    onProgress?.('Codex 已开始执行');
    const turnId = started.turn.id;
    const output = await new Promise((resolve, reject) => {
      const interrupt = error => {
        const active = this.activeTurns.get(turnId);
        if (!active) return;
        this.activeTurns.delete(turnId);
        clearTimeout(active.timer);
        clearTimeout(active.firstActionTimer);
        this.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => {});
        reject(error);
      };
      const timer = setTimeout(() => {
        interrupt(new Error(`Codex 在 ${Math.round(timeoutMs / 1000)} 秒内未完成，可缩小读取范围后重试`));
      }, timeoutMs);
      const remainingFirstActionMs = firstActionTimeoutMs ? Math.max(1, firstActionTimeoutMs - (Date.now() - runStartedAt)) : 0;
      const firstActionTimer = remainingFirstActionMs
        ? setTimeout(() => interrupt(new Error('Codex 在 30 秒内未返回行动')), remainingFirstActionMs)
        : null;
      this.activeTurns.set(turnId, {
        resolve, reject, timer, firstActionTimer, text: '', completedText: '', events: [], onProgress,
        onAction: action => { clearTimeout(firstActionTimer); onAction?.(action); }
      });
    });
    return { threadId, turnId, model: MODEL, ...output };
  }

  async status(refreshToken = false) {
    await this.start();
    const response = await this.request('account/read', { refreshToken });
    return {
      connected: Boolean(response.account),
      account: response.account?.type === 'chatgpt' ? response.account.email : response.account?.type === 'apiKey' ? 'API 密钥' : null,
      model: MODEL
    };
  }
}

module.exports = { CodexClient, MODEL };
