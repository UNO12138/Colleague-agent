(() => {
  const owner = (() => { try { return window.top.location.origin === location.origin ? window.top : window; } catch { return window; } })();
  if (owner.temporaryAiApi) return;
  let key = '';
  const stageResults = new Map();
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
        { role: 'system', content: '你是阶段内容协助 Agent。只根据本次任务说明与步骤生成阶段草稿。不得声称已经读取文件、访问网页、核实事实或完成真实任务。返回 JSON：{"summary":"简短摘要","sections":[{"title":"小节标题","body":"具体内容"}]}。提供 2 至 4 个有内容的小节。' },
        { role: 'user', content: JSON.stringify({ taskBrief: String(taskBrief || '').slice(0, 4000), stepTitle: String(stepTitle || '').slice(0, 160) }) }
      ]);
      const sections = Array.isArray(result.sections) ? result.sections.slice(0, 4).map(item => ({
        title: String(item.title || '').slice(0, 100), body: String(item.body || '').slice(0, 1000)
      })).filter(item => item.title && item.body) : [];
      if (!sections.length) throw new Error('API 未返回可展示的阶段内容');
      const summary = String(result.summary || sections[0].body).slice(0, 200);
      const markdown = `# ${stepTitle}\n\n${sections.map(item => `## ${item.title}\n\n${item.body}`).join('\n\n')}\n`;
      const preview = {
        title: stepTitle, status: 'active', timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        summary, previewType: 'document', artifactState: 'pending',
        previewData: { template: 'cards', blocks: [{ kind: 'heading1', text: stepTitle }, ...sections.flatMap(item => [{ kind: 'heading2', text: item.title }, { kind: 'paragraph', text: item.body }])], note: 'AI 阶段草稿' }
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
    async ask(message, mode = 'task_message') {
      const result = await request([
              { role: 'system', content: '你是协作助手 Alex。每次请求都是独立的，不存在聊天历史。只根据本次用户输入回答。返回 JSON 对象，字段为 kind、message、planSummary、taskCard。initial_plan 模式下 kind 为 plan_revision，planSummary 应包含任务目标、调研对象、分析重点、推进方式、最终交付及确认句，taskCard 包含 title、statusText 和 2 到 8 条 steps。plan_revision 模式下若用户明确要求调整则返回完整新规划，否则 kind 为 discussion。task_message 模式下直接回答，kind 为 discussion。不得声称已执行真实任务或生成文件。' },
              { role: 'user', content: JSON.stringify({ mode, message: String(message || '').slice(0, 12000) }) }
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
