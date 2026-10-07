(() => {
  const owner = (() => { try { return window.top.location.origin === location.origin ? window.top : window; } catch { return window; } })();
  if (owner.temporaryAiApi) return;
  let key = '';
  owner.temporaryAiApi = {
    setKey(value) { key = String(value || '').trim(); },
    clear() { key = ''; },
    ready() { return Boolean(key); },
    async ask(message, mode = 'task_message') {
      if (!key) throw new Error('请先在工具 → 云端配置临时 API 密钥');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: '你是协作助手 Alex。每次请求都是独立的，不存在聊天历史。只根据本次用户输入回答。返回 JSON 对象，字段为 kind、message、planSummary、taskCard。initial_plan 模式下 kind 为 plan_revision，planSummary 应包含任务目标、调研对象、分析重点、推进方式、最终交付及确认句，taskCard 包含 title、statusText 和 2 到 8 条 steps。plan_revision 模式下若用户明确要求调整则返回完整新规划，否则 kind 为 discussion。task_message 模式下直接回答，kind 为 discussion。不得声称已执行真实任务或生成文件。' },
              { role: 'user', content: JSON.stringify({ mode, message: String(message || '').slice(0, 12000) }) }
            ],
            response_format: { type: 'json_object' },
            stream: false
          }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || `API 请求失败（${response.status}）`);
        const raw = body.choices?.[0]?.message?.content;
        if (!raw) throw new Error('API 未返回内容');
        const result = JSON.parse(raw);
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
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('API 请求超时');
        throw error;
      } finally { clearTimeout(timeout); }
    }
  };
})();
