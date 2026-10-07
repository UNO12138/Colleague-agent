(() => {
  const owner = (() => { try { return window.top.location.origin === location.origin ? window.top : window; } catch { return window; } })();
  if (owner.temporaryAiApi) return;
  let key = '';
  const stageResults = new Map();
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
        { role: 'system', content: '你是文档协助 Agent。根据给定任务说明和阶段草稿，生成可下载的 Markdown 报告草稿。不得声称已经执行真实任务或核实外部事实。返回 JSON：{"markdown":"完整 Markdown 报告"}。' },
        { role: 'user', content: JSON.stringify({ title: String(title || '').slice(0, 80), taskBrief: String(taskBrief || '').slice(0, 4000), simulatedStages: stages.map(item => item.markdown.slice(0, 3000)) }) }
      ]);
      const markdown = String(result.markdown || '').trim();
      if (markdown.length < 100) throw new Error('API 未返回有效的报告草稿');
      return `${markdown}\n`;
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
        inputIntent: String(context.inputIntent || '').slice(0, 40)
      };
      const result = await request([
              { role: 'system', content: '你是协作助手 Alex。规划阶段会给你当前规划和最近的规划讨论；请保持上下文连续，识别“这个”“再加上”等指代，在当前规划上完整修订，不要每轮从零开始。执行阶段只给当前任务状态，不附聊天历史。直接、有针对性地回答本次问题，不要只回复“收到”或复述固定进度。只返回 JSON 对象，字段为 kind、message、planSummary、taskCard。initial_plan：kind 为 plan_revision，从用户任务生成完整规划，planSummary 依次包含任务目标、调研对象、分析重点、推进方式、最终交付和确认句；taskCard 包含 title、statusText 和 2 到 8 条具体步骤。plan_revision：若本次输入明确要求调整，结合 currentPlan 和最近讨论生成吸收修改后的完整规划和任务卡，kind 为 plan_revision；若只是提问，kind 为 discussion，直接回答，不改规划。task_message：结合 currentPlan、currentStep 和 progress 回答本次问题，kind 默认为 discussion；不要把页面进度说成已验证的真实执行结果。不得声称已运行工具或生成文件。' },
              ...planningHistory,
              { role: 'user', content: JSON.stringify({ mode, message: String(message || '').slice(0, 12000), taskContext }) }
      ]);
        return {
          kind: ['discussion', 'plan_revision', 'task_change', 'decision_request'].includes(result.kind) ? result.kind : 'discussion',
          message: String(result.message || '').slice(0, 4000),
          planSummary: String(result.planSummary || '').slice(0, 3000),
          changeSummary: '',
          taskCard: {
            title: String(result.taskCard?.title || '').slice(0, 80),
            statusText: String(result.taskCard?.statusText || '').slice(0, 240),
            steps: Array.isArray(result.taskCard?.steps) ? result.taskCard.steps.slice(0, 8).map(String) : []
          },
          decision: { required: false, title: '', detail: '', command: '', subject: '', tags: [] },
          deliverable: { summary: '', fileName: '', fileType: '', extension: '', path: '' }
        };
    }
  };
})();
