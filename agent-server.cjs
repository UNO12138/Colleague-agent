const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.COLLEAGUE_AGENT_PORT || 8787);
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const API_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
let apiKey = process.env.DEEPSEEK_API_KEY || '';
const ALLOWED_MODES = new Set(['initial_plan', 'plan_revision', 'task_message', 'decision_request']);
const ALLOWED_KINDS = new Set(['plan_revision', 'discussion', 'task_change', 'decision_request']);
const PLANNING_GUIDE_PATH = path.join(__dirname, 'prompts', 'alex-planning.md');
const LOCAL_ENV_PATH = path.join(__dirname, '.env.local');

function isTrustedOrigin(origin) {
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '') || origin === 'null' || origin === 'file://';
}

function setCors(response, origin) {
  if (isTrustedOrigin(origin)) {
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
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek 设置</title><style>body{margin:0;background:#f5f6fa;font:14px Inter,"Microsoft YaHei",sans-serif;color:#171717}.card{width:min(440px,calc(100% - 40px));margin:12vh auto;padding:28px;border:1px solid #ddd;border-radius:16px;background:#fff;box-shadow:0 16px 50px #00000012}h1{margin:0 0 8px;font-size:20px}p{color:#666;line-height:1.6}input{box-sizing:border-box;width:100%;margin:16px 0 12px;padding:12px;border:1px solid #bbb;border-radius:9px;font:inherit}button{width:100%;padding:11px;border:0;border-radius:9px;background:#4457de;color:#fff;font:inherit;font-weight:650;cursor:pointer}.ok{padding:10px;border-radius:8px;background:#eef8e8;color:#32730d}</style><main class="card"><h1>连接 DeepSeek API</h1>${saved ? '<p class="ok">已保存到本机配置，重启后仍可使用，可以关闭此页面。</p>' : '<p>密钥保存在本机的 .env.local 中，并由 Git 忽略，不会进入代码提交。</p><form method="post" action="/configure"><input name="key" type="password" autocomplete="off" placeholder="粘贴 DeepSeek API Key" required><button type="submit">保存并连接</button></form>'}</main></html>`);
}

function persistApiKey(nextKey) {
  if (/\r|\n/.test(nextKey)) throw new Error('密钥格式无效');
  const current = fs.existsSync(LOCAL_ENV_PATH) ? fs.readFileSync(LOCAL_ENV_PATH, 'utf8') : '';
  const line = `DEEPSEEK_API_KEY=${nextKey}`;
  const updated = /^DEEPSEEK_API_KEY=.*$/m.test(current)
    ? current.replace(/^DEEPSEEK_API_KEY=.*$/m, line)
    : `${current.trimEnd()}${current.trim() ? '\n' : ''}${line}\n`;
  fs.writeFileSync(LOCAL_ENV_PATH, updated, 'utf8');
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
- initial_plan：这是新对话的第一条任务请求，不存在旧任务。kind 必须为 plan_revision；直接从零生成完整任务 brief，planSummary 依次明确写出“任务目标：”“调研对象：”“分析重点：”“推进方式：”“最终交付：”五项并以独立确认句收尾。不得称为修改、调整或补充，不得引用任何旧任务。message 简洁说明已形成初步任务理解。taskCard 必须填写可直接执行的新任务卡片。
- plan_revision：先判断用户是在提问，还是明确要求修改规划。若用户主要是在询问原因、含义、可行性、区别或寻求解释，且没有明确要求改变目标、范围、交付物或步骤，kind 必须为 discussion：message 先直接回答疑问，可在结尾简短说明有哪些可修改方向，但不得擅自生成修改方案、不得改写任务 brief，planSummary 与 changeSummary 留空，taskCard 返回空内容。只有用户明确提出增加、删除、替换或调整任务要求时，kind 才为 plan_revision：message 只简洁说明这次改了什么；planSummary 必须重新生成一份已经吸收本次修改的完整任务 brief，并依次明确写出“任务目标：”“调研对象：”“分析重点：”“推进方式：”“最终交付：”五项，将变化直接写入对应项中，最后用独立确认句收尾。不得沿用包含旧要求的描述，不得在末尾追加“本次补充”，也不得把 message 原句再单独重复一次。
- task_message：优先结合 context.recentConversation 直接回答用户的问题，并以 context.currentTaskState 为唯一的当前进度依据；不要重复近期回答，不要用历史消息里的旧进度覆盖当前状态。context.inputIntent=planning_question 表示用户仍处于规划确认阶段且当前输入已被前端识别为疑问或非修改意见：kind 必须为 discussion，像正常对话一样完整回应。此时不限制回答长度、不要求固定段落或格式；根据问题需要充分解释判断依据、差异、例子与取舍，不要为了简短而省略关键内容，也不要只说有哪些可调整方向。唯一边界是绝不更新任务 brief 或 taskCard。context.progressAction 非空时表示用户明确要求的执行推进已由前端完成，kind 使用 discussion，不要识别成范围修改。意图分类不能取代回答。普通问答或讨论的 kind 为 discussion；明确改变目标、范围、交付物或优先级时为 task_change；需要授权、外部访问、发送信息或其他用户决定时为 decision_request。
- decision_request：kind 必须为 decision_request。
- message 应像 Alex 的自然回复。除 context.inputIntent=planning_question 外保持简洁自然，控制在 80 字以内；planning_question 按问题本身所需篇幅完整回答，不设字数或固定格式要求。
- changeSummary 仅在 task_change 时填写；planSummary 仅在真正修改规划的 plan_revision 时填写，其余填空字符串。
- plan_revision 和 task_change 必须填写 taskCard，内容是吸收本次修改后的完整主进程卡片：title 是不超过 8 个字的任务类型，statusText 是当前执行说明，steps 是 2 到 8 条按执行顺序排列的简洁步骤。优先参考 context.currentTaskCard，在原卡片上准确增删或改写，不要只返回本次增量。
- discussion 和 decision_request 不得改变主进程卡片，taskCard 返回空 title、空 statusText 和空数组。
- decision_request 时 decision.required=true，并填写标题、说明、操作对象和可选命令。decision.tags 必须恰好按“类型 → 细分类型 → 风险程度”返回 3 项：第 1 项类型只能是“访问外部信息、访问本地资源、修改本地内容、连接第三方服务、向外部传输数据、执行高影响操作”之一；第 2 项填写最关键的细分类型（多个细分风险可用“、”合并）；第 3 项只能是“低风险、中风险、高风险”之一。细分类型优先使用“公开信息读取、敏感信息访问、大范围读取、文件创建、文件修改、文件覆盖、文件删除、批量操作、移动 / 重命名、执行代码 / 命令、安装 / 修改依赖、修改系统配置、账户授权、权限提升、凭证使用、数据上传、敏感数据外传、第三方共享、消息发送、公开发布、外部数据修改、外部数据删除、部署 / 上线、财务 / 交易操作”。其他情况 decision.required=false，其余字段填空字符串或空数组。

JSON 必须完整包含以下字段：
{"kind":"discussion","message":"","planSummary":"","changeSummary":"","taskCard":{"title":"","statusText":"","steps":[]},"decision":{"required":false,"title":"","detail":"","command":"","subject":"","tags":[]}}`;
}

function normalizeResult(value) {
  if (!value || typeof value !== 'object' || !ALLOWED_KINDS.has(value.kind)) {
    throw new Error('DeepSeek 返回了无效的意图类型');
  }
  const decision = value.decision && typeof value.decision === 'object' ? value.decision : {};
  const taskCard = value.taskCard && typeof value.taskCard === 'object' ? value.taskCard : {};
  return {
    kind: value.kind,
    message: String(value.message || '').slice(0, 4000),
    planSummary: String(value.planSummary || '').slice(0, 1000),
    changeSummary: String(value.changeSummary || '').slice(0, 1000),
    taskCard: {
      title: String(taskCard.title || '').slice(0, 80),
      statusText: String(taskCard.statusText || '').slice(0, 240),
      steps: Array.isArray(taskCard.steps) ? taskCard.steps.slice(0, 8).map(step => String(step).slice(0, 160)).filter(Boolean) : []
    },
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
        max_tokens: 2400,
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
      persistApiKey(nextKey);
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
  if (!isTrustedOrigin(origin)) {
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
