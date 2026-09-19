const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.COLLEAGUE_AGENT_PORT || 8787);
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const API_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
let apiKey = process.env.DEEPSEEK_API_KEY || '';
const ALLOWED_MODES = new Set(['plan_revision', 'task_message', 'decision_request']);
const ALLOWED_KINDS = new Set(['plan_revision', 'discussion', 'task_change', 'decision_request']);
const PLANNING_GUIDE_PATH = path.join(__dirname, 'prompts', 'alex-planning.md');

function setCors(response, origin) {
  if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendSetupPage(response, saved = false) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek 设置</title><style>body{margin:0;background:#f5f6fa;font:14px Inter,"Microsoft YaHei",sans-serif;color:#171717}.card{width:min(440px,calc(100% - 40px));margin:12vh auto;padding:28px;border:1px solid #ddd;border-radius:16px;background:#fff;box-shadow:0 16px 50px #00000012}h1{margin:0 0 8px;font-size:20px}p{color:#666;line-height:1.6}input{box-sizing:border-box;width:100%;margin:16px 0 12px;padding:12px;border:1px solid #bbb;border-radius:9px;font:inherit}button{width:100%;padding:11px;border:0;border-radius:9px;background:#4457de;color:#fff;font:inherit;font-weight:650;cursor:pointer}.ok{padding:10px;border-radius:8px;background:#eef8e8;color:#32730d}</style><main class="card"><h1>连接 DeepSeek API</h1>${saved ? '<p class="ok">已保存到当前本地进程，可以关闭此页面。</p>' : '<p>密钥只保存在当前 Agent 进程的内存中，不会写入项目文件。</p><form method="post" action="/configure"><input name="key" type="password" autocomplete="off" placeholder="粘贴 DeepSeek API Key" required><button type="submit">保存并连接</button></form>'}</main></html>`);
}

function readForm(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8192) reject(new Error('请求内容过长'));
    });
    request.on('end', () => resolve(new URLSearchParams(raw)));
    request.on('error', reject);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (rejected) return;
      raw += chunk;
      if (raw.length > 32768) {
        rejected = true;
        reject(new Error('请求内容过长'));
      }
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('请求不是有效 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function buildPrompt({ mode, message, context }) {
  const planningGuide = fs.readFileSync(PLANNING_GUIDE_PATH, 'utf8');
  return `${planningGuide}

请根据用户消息和当前任务上下文，只返回一个 JSON 对象，不要添加 Markdown 或解释。

模式：${mode}
用户消息：${message}
当前上下文：${JSON.stringify(context || {})}

判断规则：
- plan_revision：规划确认前的补充或修改，kind 必须为 plan_revision。message 作为第一段，只写本次修改及新的侧重点；planSummary 作为第二段，只浓缩未变化的任务对象、使用场景、推进方式和交付物，不得再次描述被修改的重点，也不得重复第一段的关键词或同义表达。两段不添加标题或列表。
- task_message：优先结合 context.recentConversation 直接回答用户的问题，并以 context.currentTaskState 为唯一的当前进度依据；不要重复近期回答，不要用历史消息里的旧进度覆盖当前状态。context.progressAction 非空时表示用户明确要求的执行推进已由前端完成，kind 使用 discussion，不要识别成范围修改。意图分类不能取代回答。普通问答或讨论的 kind 为 discussion；明确改变目标、范围、交付物或优先级时为 task_change；需要授权、外部访问、发送信息或其他用户决定时为 decision_request。
- decision_request：kind 必须为 decision_request。
- message 应像 Alex 的自然回复，简洁自然，控制在 80 字以内。
- changeSummary 仅在 task_change 时填写；planSummary 仅在 plan_revision 时填写，其余填空字符串。
- decision_request 时 decision.required=true，并填写标题、说明、操作对象、可选命令和最多 3 个风险标签；其他情况 decision.required=false，其余字段填空字符串或空数组。

JSON 必须完整包含以下字段：
{"kind":"discussion","message":"","planSummary":"","changeSummary":"","decision":{"required":false,"title":"","detail":"","command":"","subject":"","tags":[]}}`;
}

function normalizeResult(value) {
  if (!value || typeof value !== 'object' || !ALLOWED_KINDS.has(value.kind)) {
    throw new Error('DeepSeek 返回了无效的意图类型');
  }
  const decision = value.decision && typeof value.decision === 'object' ? value.decision : {};
  return {
    kind: value.kind,
    message: String(value.message || '').slice(0, 400),
    planSummary: String(value.planSummary || '').slice(0, 1000),
    changeSummary: String(value.changeSummary || '').slice(0, 1000),
    decision: {
      required: Boolean(decision.required),
      title: String(decision.title || '').slice(0, 300),
      detail: String(decision.detail || '').slice(0, 500),
      command: String(decision.command || '').slice(0, 500),
      subject: String(decision.subject || '').slice(0, 200),
      tags: Array.isArray(decision.tags) ? decision.tags.slice(0, 3).map(tag => String(tag).slice(0, 40)) : []
    }
  };
}

async function runDeepSeek(payload) {
  if (!apiKey || apiKey.includes('粘贴到这里')) throw new Error('尚未配置 DEEPSEEK_API_KEY');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: '你是协作 Agent Alex。你既要直接回答用户在即时交流中的问题，也要为界面判断意图类型。不要运行工具、修改文件或替用户做决定。'
          },
          { role: 'user', content: buildPrompt(payload) }
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.1,
        max_tokens: 800,
        stream: false
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errorPayload = JSON.parse(raw);
        detail = errorPayload.error?.message || detail;
      } catch {}
      throw new Error(`DeepSeek 请求失败：${detail}`);
    }
    const completion = JSON.parse(raw);
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek 未返回内容');
    return normalizeResult(JSON.parse(content));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('DeepSeek 响应超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  setCors(response, origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/setup') {
    sendSetupPage(response);
    return;
  }
  if (request.method === 'POST' && request.url === '/configure') {
    try {
      const form = await readForm(request);
      const nextKey = String(form.get('key') || '').trim();
      if (!nextKey) throw new Error('密钥不能为空');
      apiKey = nextKey;
      sendSetupPage(response, true);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || '保存失败' });
    }
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(apiKey) && !apiKey.includes('粘贴到这里'),
      provider: 'deepseek',
      model: MODEL,
      mode: 'intent-only'
    });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/agent') {
    sendJson(response, 404, { ok: false, error: 'Not found' });
    return;
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    sendJson(response, 403, { ok: false, error: '不受信任的来源' });
    return;
  }
  try {
    const payload = await readJson(request);
    if (!ALLOWED_MODES.has(payload.mode)) throw new Error('不支持的 Agent 模式');
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 4000) {
      throw new Error('消息长度无效');
    }
    const startedAt = Date.now();
    const result = await runDeepSeek({ ...payload, message: payload.message.trim() });
    sendJson(response, 200, {
      ok: true,
      provider: 'deepseek',
      model: MODEL,
      latencyMs: Date.now() - startedAt,
      result
    });
  } catch (error) {
    sendJson(response, 502, { ok: false, error: error.message || 'Agent 调用失败' });
  }
});

server.listen(PORT, HOST, () => {
  const state = apiKey && !apiKey.includes('粘贴到这里') ? 'configured' : 'missing DEEPSEEK_API_KEY';
  console.log(`Local DeepSeek adapter listening on http://${HOST}:${PORT} (${MODEL}, ${state})`);
});
