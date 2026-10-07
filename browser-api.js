(() => {
  const owner = (() => { try { return window.top.location.origin === location.origin ? window.top : window; } catch { return window; } })();
  if (owner.temporaryAiApi) return;
  let key = '';
  const stageResults = new Map();
  function taskStepLabel(value) {
    const text = typeof value === 'string' ? value : value && typeof value === 'object'
      ? [value.title, value.text, value.label, value.name, value.step, value.description].find(item => typeof item === 'string') || '' : '';
    const label = String(text || '').trim();
    return label === '[object Object]' ? '' : label.slice(0, 160);
  }
  function stageTable(raw) {
    if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
    const columns = raw.columns.slice(0, 6).map(value => String(value || '').trim().slice(0, 80));
    if (columns.length < 2 || columns.some(value => !value)) return null;
    const rows = raw.rows.slice(0, 12).filter(Array.isArray).map(row => row.slice(0, columns.length).map(value => String(value ?? '').trim().slice(0, 180)));
    return rows.length >= 1 && rows.every(row => row.length === columns.length) ? { columns, rows } : null;
  }
  function numericChart(table) {
    if (!table || table.columns.length !== 2 || table.rows.length < 2) return null;
    const points = table.rows.map(row => {
      const match = row[1].match(/^(-?\d+(?:\.\d+)?)\s*(%|[a-zA-Z\u4e00-\u9fff]*)$/u);
      return match ? { label: row[0], value: Number(match[1]), display: row[1], unit: match[2] } : null;
    });
    if (points.some(point => !point || !Number.isFinite(point.value) || point.value < 0)) return null;
    if (new Set(points.map(point => point.unit)).size !== 1) return null;
    const isComposition = points[0].unit === '%' && Math.abs(points.reduce((sum, point) => sum + point.value, 0) - 100) <= 1;
    return { labelHeader: table.columns[0], valueHeader: table.columns[1], points, isComposition };
  }
  async function request(messages) {
    if (!key) throw new Error('请先在工具 → 云端配置临时 API 密钥');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages, response_format: { type: 'json_object' }, stream: false }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || `API 请求失败（${response.status}）`);
      const raw = body.choices?.[0]?.message?.content;
      if (!raw) throw new Error('API 未返回内容');
      return JSON.parse(raw);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('API 请求超时');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  owner.temporaryAiApi = {
    setKey(value) { key = String(value || '').trim(); },
    clear() { key = ''; },
    ready() { return Boolean(key); },
    listStages(conversationId) { return [...(stageResults.get(conversationId)?.values() || [])]; },
    async generateStage({ conversationId, stepTitle, taskBrief }) {
      const result = await request([
        { role: 'system', content: '你是阶段内容协助 Agent。根据本次任务说明与步骤生成阶段草稿。返回 JSON：{"summary":"简短摘要","layout":"summary或cards","sections":[{"title":"小节标题","body":"具体内容"}],"table":{"columns":["列1","列2"],"rows":[["值1","值2"]]}}。有明确数据、指标或对比项时，把具体数据直接放进 table，不要只写概括；没有适合的数据表则省略 table。叙述性内容用 summary，多个独立类别才用 cards。只使用输入中给出的数值，不要编造指标。不得声称已读取文件、访问网页或核实外部事实。' },
        { role: 'user', content: JSON.stringify({ taskBrief: String(taskBrief || '').slice(0, 4000), stepTitle: String(stepTitle || '').slice(0, 160) }) }
      ]);
      const sections = Array.isArray(result.sections) ? result.sections.slice(0, 4).map(item => ({
        title: String(item.title || '').slice(0, 100), body: String(item.body || '').slice(0, 1000)
      })).filter(item => item.title && item.body) : [];
      const table = stageTable(result.table);
      if (!sections.length && !table) throw new Error('API 未返回可展示的阶段内容');
      const summary = String(result.summary || sections[0]?.body || table?.rows[0]?.join('：') || '').slice(0, 200);
      const markdownTable = table ? `| ${table.columns.map(value => value.replace(/\|/gu, '｜')).join(' | ')} |\n| ${table.columns.map(() => '---').join(' | ')} |\n${table.rows.map(row => `| ${row.map(value => value.replace(/\|/gu, '｜')).join(' | ')} |`).join('\n')}` : '';
      const markdown = `# ${stepTitle}\n\n${markdownTable}${markdownTable && sections.length ? '\n\n' : ''}${sections.map(item => `## ${item.title}\n\n${item.body}`).join('\n\n')}\n`;
      const chart = numericChart(table);
      const template = table ? (chart ? chart.isComposition ? 'donut' : 'chart' : 'comparison') : result.layout === 'cards' && sections.length >= 2 ? 'cards' : 'summary';
      const preview = {
        title: stepTitle, status: 'active', timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        summary, previewType: 'document', artifactState: 'pending',
        previewData: { template, blocks: [{ kind: 'heading1', text: stepTitle }, ...(table ? [{ kind: 'table', columns: table.columns, rows: table.rows }] : []), ...sections.flatMap(item => [{ kind: 'heading2', text: item.title }, { kind: 'paragraph', text: item.body }])], chart, note: 'AI 阶段草稿' }
      };
      if (!stageResults.has(conversationId)) stageResults.set(conversationId, new Map());
      stageResults.get(conversationId).set(stepTitle, { stepTitle, markdown, preview });
      return { markdown, preview };
    },
    async generateFinal({ conversationId, title, taskBrief }) {
      const stages = this.listStages(conversationId);
      const result = await request([
        { role: 'system', content: '你是文档协助 Agent。根据任务说明和已生成的阶段内容，撰写一份可交付的中文 Word 报告。只返回 JSON：{"fileName":"具体文件名.docx","summary":"一句话摘要","sections":[{"heading":"章节标题","body":"该章节的具体正文，可用换行分段"}]}。至少 2 个章节，包含任务目标、已有阶段发现和建议；使用输入里的具体信息，不写空泛占位文字。不编造数据、来源或已核实的事实；对未验证的内容明确说明。文件名不能包含路径或特殊文件名字符。' },
        { role: 'user', content: JSON.stringify({ title: String(title || '').slice(0, 80), taskBrief: String(taskBrief || '').slice(0, 4000), stages: stages.map(item => item.markdown.slice(0, 3000)) }) }
      ]);
      const extension = 'docx';
      const base = String(result.fileName || title || '任务成果').replace(/\.[a-z0-9]+$/i, '').trim();
      const fileName = owner.FileArtifact?.makeArtifactFileName(base, extension)
        || `${base.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, '-').slice(0, 64) || '任务成果'}.${extension}`;
      const sections = Array.isArray(result.sections) ? result.sections.slice(0, 12).map(item => ({
        heading: String(item.heading || '').trim().slice(0, 100),
        body: String(item.body || '').trim().slice(0, 5000)
      })).filter(item => item.heading && item.body) : [];
      if (sections.length < 2) throw new Error('API 未返回足够的报告正文');
      return { wordDocument: true, fileName, extension, title: String(title || base).slice(0, 100), summary: String(result.summary || 'Word 报告已生成。').slice(0, 240), sections };
    },
    async ask(message, mode = 'task_message', context = {}) {
      const planning = mode === 'plan_revision' || context.inputIntent === 'planning_question';
      const planningHistory = planning && Array.isArray(context.planningHistory)
        ? context.planningHistory.slice(-10).filter(item => ['user', 'assistant'].includes(item.role))
          .map(item => ({ role: item.role, content: String(item.content || '').slice(0, 1200) })).filter(item => item.content)
        : [];
      const taskContext = mode === 'initial_plan' ? {} : {
        currentPlan: String(context.currentPlan || '').slice(0, 3000),
        currentStep: String(context.currentStep || '').slice(0, 240),
        progress: String(context.progress || '').slice(0, 20),
        taskStarted: Boolean(context.taskStarted),
        inputIntent: String(context.inputIntent || '').slice(0, 40),
        currentTaskCard: context.currentTaskCard || {},
        currentRequirements: String(context.currentRequirements || '').slice(0, 500),
        recentUserInputs: context.inputIntent === 'task_change' && Array.isArray(context.recentUserInputs)
          ? context.recentUserInputs.slice(-10).map(value => String(value).slice(0, 500)) : []
      };
      const result = await request([
              { role: 'system', content: '你是协作助手 Alex。只返回 JSON 对象，字段为 kind、message、planSummary、changeSummary、requirementsSummary、taskCard。规划阶段根据当前规划与最近讨论连续修订。initial_plan：kind 为 plan_revision，生成完整规划和 2 到 8 条步骤。plan_revision：明确修改时生成吸收要求的完整规划及任务卡；单纯提问时直接回答，kind 为 discussion。task_message：普通问答 kind 为 discussion，直接回答本次问题，不要反复询问 currentPlan 或 currentRequirements 中已确认的条件，也不要把页面进度说成真实核验结果。若 inputIntent=task_change，用户是在执行中补充条件或要求写入主任务，kind 必须为 task_change；结合 currentPlan、currentRequirements 和 recentUserInputs，识别已经给出的天数、人数、儿童、出行时间、住宿、偏好等，不能丢失或反向猜测；message 简洁说明将弹出确认；changeSummary 简述要加入的完整条件；requirementsSummary 用一句紧凑文字列出所有已确认条件；planSummary 重写吸收这些条件的完整主任务规划；taskCard 在现有步骤上更新必要内容，返回完整的 title、statusText 和 2 到 8 条 steps。不要声称已实际应用，必须等待用户点击“应用到主任务”。不得声称已运行工具或生成文件。' },
              ...planningHistory,
              { role: 'user', content: JSON.stringify({ mode, message: String(message || '').slice(0, 12000), taskContext }) }
      ]);
        return {
          kind: context.inputIntent === 'task_change' ? 'task_change' : ['discussion', 'plan_revision', 'task_change', 'decision_request'].includes(result.kind) ? result.kind : 'discussion',
          message: String(result.message || '').slice(0, 4000),
          planSummary: String(result.planSummary || '').slice(0, 3000),
          changeSummary: String(result.changeSummary || (context.inputIntent === 'task_change' ? message : '')).slice(0, 1000),
          requirementsSummary: String(result.requirementsSummary || [context.currentRequirements, result.changeSummary || (context.inputIntent === 'task_change' ? message : '')].filter(Boolean).join('；')).slice(0, 500),
          taskCard: {
            title: (taskStepLabel(result.taskCard?.title) || taskStepLabel(context.currentTaskCard?.title)).slice(0, 80),
            statusText: (taskStepLabel(result.taskCard?.statusText) || taskStepLabel(context.currentTaskCard?.statusText)).slice(0, 240),
            steps: Array.isArray(result.taskCard?.steps) && result.taskCard.steps.length >= 2
              ? result.taskCard.steps.slice(0, 8).map(taskStepLabel).filter(Boolean) : Array.isArray(context.currentTaskCard?.steps) ? context.currentTaskCard.steps.slice(0, 8).map(taskStepLabel).filter(Boolean) : []
          },
          decision: { required: false, title: '', detail: '', command: '', subject: '', tags: [] },
          deliverable: { summary: '', fileName: '', fileType: '', extension: '', path: '' }
        };
    }
  };
})();
