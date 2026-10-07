/* Structured stage previews. The agent supplies data; this file owns the only allowed UI shapes. */
(() => {
  const previewTypes = new Set(['text', 'data', 'chart', 'image', 'gallery', 'reference', 'file', 'code', 'structure', 'process', 'document']);
  const make = (tag, className = '', value = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value) element.textContent = String(value);
    return element;
  };
  const strings = (value, limit = 3) => Array.isArray(value) ? value.slice(0, limit).map(item => String(item).slice(0, 180)) : [];
  const internalImage = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  };
  const referenceUrl = value => {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  };

  /** StepPreview: { status, title, timestamp, summary, previewType, previewData, sources, artifactState }. */
  function normalizeStepPreview(value = {}) {
    const previewType = previewTypes.has(value.previewType) ? value.previewType : 'process';
    return {
      status: ['done', 'active', 'waiting'].includes(value.status) ? value.status : 'waiting',
      title: String(value.title || '未命名步骤').slice(0, 160),
      timestamp: String(value.timestamp || '').slice(0, 32),
      summary: String(value.summary || '').slice(0, 240),
      previewType,
      previewData: value.previewData && typeof value.previewData === 'object' ? value.previewData : {},
      sources: Array.isArray(value.sources) ? value.sources.slice(0, 3) : [],
      artifactState: value.artifactState === 'available' ? 'available' : 'pending'
    };
  }

  function appendList(parent, values) {
    const list = make('ul', 'step-preview-list');
    strings(values).forEach(value => list.append(make('li', '', value)));
    parent.append(list);
  }

  function appendFileArtifact(parent, file, label = '过程文件') {
    const card = make('div');
    if (window.FileArtifact?.renderFileArtifact(card, file, { label })) parent.append(card);
  }

  function contentSections(blocks) {
    const sections = [];
    let lead = '';
    blocks.forEach(block => {
      const text = String(block.text || '').slice(0, 500);
      if (block.kind === 'heading1') return;
      if (block.kind === 'heading2' || block.kind === 'heading3') sections.push({ title: text, texts: [] });
      else if (sections.length && text) sections.at(-1).texts.push(text);
      else if (!lead && text) lead = text;
    });
    return { sections, lead };
  }

  function renderWorkflow(step, data) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const { sections, lead } = contentSections(blocks);
    const visual = make('section', 'linear-workflow-visual');
    const head = make('div', 'semantic-visual-head');
    const title = make('div');
    title.append(make('span', 'semantic-product linear-product', 'WORKFLOW'));
    title.append(make('h3', '', blocks.find(block => block.kind === 'heading1')?.text || step.title));
    head.append(title, make('span', 'semantic-insight-tag', '工作流视图'));

    const flow = make('div', 'linear-status-flow');
    const stages = sections.map(section => [section.title, section.texts[0] || '', section.texts.slice(1).join(' ') || '']);
    stages.slice(0, 6).forEach(([state, action, signal], index) => {
      const column = make('article', 'linear-status-column');
      const stateLine = make('div', 'linear-state-line');
      stateLine.append(make('span', `linear-state-dot state-${index + 1}`), make('strong', '', state));
      column.append(stateLine, make('p', '', action), make('small', '', signal));
      flow.append(column);
    });

    visual.append(head);
    if (flow.childElementCount) visual.append(flow);
    if (lead) visual.append(make('p', 'workflow-lead', lead));
    visual.append(make('p', 'semantic-source-note', data.offlineArchive ? '预设情境的离线阶段界面存档' : '协作 Agent 从本次主进程内容中抽取并生成'));
    return visual;
  }

  function renderCanvas(step, data) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const { sections, lead } = contentSections(blocks);
    const visual = make('section', 'miro-canvas-visual');
    const head = make('div', 'semantic-visual-head');
    const title = make('div');
    title.append(make('span', 'semantic-product miro-product', 'CANVAS'));
    title.append(make('h3', '', blocks.find(block => block.kind === 'heading1')?.text || step.title));
    head.append(title, make('span', 'semantic-insight-tag', '画布聚类视图'));

    const canvas = make('div', 'miro-canvas');
    const tones = ['yellow', 'blue', 'pink'];
    const clusters = sections.map((section, index) => ({ title: section.title, tone: tones[index % tones.length], notes: section.texts }));
    clusters.forEach(cluster => {
      const group = make('section', 'miro-cluster');
      group.append(make('h4', '', cluster.title));
      cluster.notes.slice(0, 4).forEach((note, index) => {
        const sticky = make('div', `miro-sticky sticky-${cluster.tone}`);
        sticky.append(make('span', '', note));
        if (index === 1) sticky.classList.add('is-offset');
        group.append(sticky);
      });
      canvas.append(group);
    });

    visual.append(head);
    if (canvas.childElementCount) visual.append(canvas);
    if (lead) {
      const synthesis = make('aside', 'miro-synthesis');
      synthesis.append(make('span', '', data.offlineArchive ? '存档摘要' : '主进程摘要'), make('strong', '', lead));
      visual.append(synthesis);
    }
    visual.append(make('p', 'semantic-source-note', data.offlineArchive ? '预设情境的离线阶段界面存档' : '协作 Agent 从本次主进程内容中抽取并生成'));
    return visual;
  }

  function renderStepPreview(rawValue) {
    const step = normalizeStepPreview(rawValue);
    const root = make('div');
    root.append(make('div', 'step-preview-summary', step.summary || '当前阶段暂无可预览的结果。'));
    const data = step.previewData;

    switch (step.previewType) {
      case 'text':
        appendList(root, data.findings);
        break;
      case 'structure':
        appendList(root, data.items);
        break;
      case 'data': {
        const rows = Array.isArray(data.metrics) ? data.metrics.slice(0, 4) : [];
        appendList(root, rows.map(item => `${String(item.label || '').slice(0, 50)}：${String(item.value || '').slice(0, 50)}`));
        break;
      }
      case 'chart': {
        const bars = make('div', 'step-preview-bars');
        const points = Array.isArray(data.points) ? data.points.slice(0, 4) : [];
        const maximum = Math.max(1, ...points.map(point => Number(point.value) || 0));
        points.forEach(point => {
          const row = make('div', 'step-preview-bar');
          const value = Math.max(0, Number(point.value) || 0);
          const track = make('div', 'step-preview-bar-track');
          const fill = make('span', 'step-preview-bar-fill');
          fill.style.width = `${Math.min(100, value / maximum * 100)}%`;
          track.append(fill);
          row.append(make('span', '', String(point.label || '').slice(0, 24)), track, make('span', '', value));
          bars.append(row);
        });
        root.append(bars);
        break;
      }
      case 'image':
      case 'gallery': {
        const images = step.previewType === 'gallery' && Array.isArray(data.images) ? data.images.slice(0, 3) : [data];
        images.forEach(image => {
          const src = internalImage(image.src);
          if (!src) return;
          const visual = make('img', 'step-preview-visual');
          visual.src = src;
          visual.alt = String(image.alt || '阶段视觉产物').slice(0, 120);
          visual.loading = 'lazy';
          root.append(visual);
        });
        break;
      }
      case 'reference': {
        const list = make('ul', 'step-preview-list');
        step.sources.forEach(source => {
          const item = make('li');
          const href = referenceUrl(source.url);
          if (href) {
            const link = make('a', '', String(source.title || href).slice(0, 100));
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            item.append(link);
          } else {
            item.textContent = String(source.title || '来源').slice(0, 100);
          }
          list.append(item);
        });
        root.append(list);
        break;
      }
      case 'file':
        if (step.artifactState === 'available' && data.path) {
          appendFileArtifact(root, { artifactState: step.artifactState, path: data.path }, data.label || '项目文件');
        } else {
          root.append(make('div', 'step-preview-note', '文件尚未生成，当前只展示处理状态。'));
        }
        break;
      case 'code':
        root.append(make('pre', 'step-preview-code', String(data.snippet || '').slice(0, 300)));
        break;
      case 'document': {
        const blocks = Array.isArray(data.blocks) ? data.blocks.slice(0, 7) : [];
        if (data.template === 'workflow') {
          root.append(renderWorkflow(step, data));
          break;
        }
        if (data.template === 'canvas') {
          root.append(renderCanvas(step, data));
          break;
        }
        const table = blocks.find(block => block.kind === 'table' && Array.isArray(block.columns) && Array.isArray(block.rows));
        if (table && ['comparison', 'chart', 'donut'].includes(data.template)) {
          const visual = make('div', 'step-comparison-visual');
          visual.append(make('div', 'step-visual-kicker', 'ALEX · 阶段产物可视化'));
          const heading = blocks.find(block => block.kind === 'heading1');
          visual.append(make('h3', 'step-visual-title', String(heading?.text || step.title).slice(0, 160)));
          const columns = table.columns.slice(0, 6);
          const rows = table.rows.slice(0, 12);
          if (data.template === 'donut' && data.chart && Array.isArray(data.chart.points)) {
            const figure = make('figure', 'step-donut-chart');
            figure.append(make('figcaption', '', String(data.chart.valueHeader || columns[1] || '构成').slice(0, 100)));
            const points = data.chart.points.slice(0, 6);
            const colors = ['#596ee8', '#7e8deb', '#a9b4f0', '#e1b566', '#eb8e7f', '#78b99a'];
            let cursor = 0;
            const stops = points.map((point, index) => {
              const start = cursor;
              cursor += Math.max(0, Number(point.value) || 0);
              return `${colors[index]} ${start}% ${cursor}%`;
            });
            const ring = make('div', 'step-donut-ring');
            ring.style.background = `conic-gradient(${stops.join(',')})`;
            ring.append(make('span', '', '100%'));
            const legend = make('div', 'step-donut-legend');
            points.forEach((point, index) => {
              const item = make('div', 'step-donut-legend-item');
              const dot = make('span', 'step-donut-dot');
              dot.style.background = colors[index];
              item.append(dot, make('span', '', String(point.label || '').slice(0, 80)), make('strong', '', String(point.display || '').slice(0, 40)));
              legend.append(item);
            });
            const body = make('div', 'step-donut-body');
            body.append(ring, legend);
            figure.append(body);
            visual.append(figure);
          } else if (data.template === 'chart' && data.chart && Array.isArray(data.chart.points)) {
            const figure = make('figure', 'step-comparison-chart');
            figure.append(make('figcaption', '', String(data.chart.valueHeader || columns[1] || '数值').slice(0, 100)));
            const points = data.chart.points.slice(0, 8);
            const maximum = Math.max(1, ...points.map(point => Number(point.value) || 0));
            points.forEach(point => {
              const row = make('div', 'step-comparison-bar');
              const track = make('div', 'step-comparison-bar-track');
              const fill = make('span', 'step-comparison-bar-fill');
              fill.style.width = `${Math.min(100, Math.max(0, Number(point.value) || 0) / maximum * 100)}%`;
              track.append(fill);
              row.append(make('span', 'step-comparison-bar-label', String(point.label || '').slice(0, 80)), track, make('strong', 'step-comparison-bar-value', String(point.display || '').slice(0, 80)));
              figure.append(row);
            });
            visual.append(figure);
          } else {
            const scroll = make('div', 'step-comparison-scroll');
            const matrix = make('table', 'step-comparison-table');
            const head = make('thead');
            const headerRow = make('tr');
            columns.forEach(column => headerRow.append(make('th', '', String(column).slice(0, 100))));
            head.append(headerRow);
            const body = make('tbody');
            rows.forEach(values => {
              const row = make('tr');
              columns.forEach((_, index) => row.append(make(index === 0 ? 'th' : 'td', '', String(values[index] || '').slice(0, 220))));
              body.append(row);
            });
            matrix.append(head, body);
            scroll.append(matrix);
            visual.append(scroll);
          }
          root.append(visual);
          break;
        }
        const board = make('div', 'step-visual-board');
        board.append(make('div', 'step-visual-kicker', 'ALEX · 阶段产物可视化'));
        const title = blocks.find(block => block.kind === 'heading1');
        if (title) board.append(make('h3', 'step-visual-title', String(title.text || '').slice(0, 160)));
        const { sections } = contentSections(blocks);
        if (data.template === 'summary') {
          blocks.filter(block => ['paragraph', 'bullet'].includes(block.kind)).slice(0, 5).forEach(block => {
            board.append(make('p', block.kind === 'bullet' ? 'step-summary-bullet' : 'step-summary-paragraph', String(block.text || '').slice(0, 650)));
          });
          root.append(board);
          break;
        }
        const grid = make('div', 'step-visual-grid');
        if (table && data.template === 'cards') {
          table.rows.slice(0, 6).forEach((values, index) => {
            const card = make('section', 'step-visual-card');
            card.append(make('span', 'step-visual-index', String(index + 1).padStart(2, '0')));
            card.append(make('h4', '', String(values[0] || '').slice(0, 160)));
            values.slice(1).forEach((value, valueIndex) => card.append(make('p', '', `${table.columns[valueIndex + 1]}：${String(value || '').slice(0, 240)}`)));
            grid.append(card);
          });
        }
        if (data.template === 'cards' && !sections.length) {
          blocks.filter(block => block.kind === 'bullet').slice(0, 6).forEach((block, index) => {
            const card = make('section', 'step-visual-card');
            card.append(make('span', 'step-visual-index', String(index + 1).padStart(2, '0')));
            card.append(make('p', '', String(block.text || '').slice(0, 500)));
            grid.append(card);
          });
        }
        sections.slice(0, 3).forEach((section, index) => {
          const card = make('section', 'step-visual-card');
          card.append(make('span', 'step-visual-index', String(index + 1).padStart(2, '0')));
          card.append(make('h4', '', section.title));
          section.texts.slice(0, 1).forEach(value => card.append(make('p', '', value)));
          grid.append(card);
        });
        if (grid.childElementCount) board.append(grid);
        else blocks.filter(block => block.kind === 'paragraph').slice(0, 2).forEach(block => board.append(make('p', 'step-visual-fallback', String(block.text || '').slice(0, 650))));
        root.append(board);
        break;
      }
      case 'process':
        root.append(make('div', 'step-preview-note', String(data.detail || '尚无真实中间产物。').slice(0, 160)));
        break;
    }
    if (data.note && step.previewType !== 'process') root.append(make('div', 'step-preview-note', String(data.note).slice(0, 160)));
    return root;
  }

  // Explicitly labelled example task. Its image and file point to assets already present in this project.
  const demoSteps = [
    { title: '梳理页面结构', status: 'done', timestamp: '14:31', summary: '已形成原型的主要页面层级。', previewType: 'structure', previewData: { items: ['对话工作区', '项目与最近记录', '输入区与决策区'], note: '结构预览 · 样例数据' } },
    { title: '总结交互重点', status: 'done', timestamp: '14:34', summary: '当前最关键的是让任务状态和阶段结果可见。', previewType: 'text', previewData: { findings: ['对话负责提出任务与追问。', '进度卡展示每一步的状态和结果。', '需要确认的动作回到输入区。'], note: '文本摘要 · 样例数据' } },
    { title: '比较阶段耗时', status: 'done', timestamp: '14:37', summary: '同单位数值用横向条形图呈现。', previewType: 'document', previewData: { template: 'chart', blocks: [{ kind: 'heading1', text: '阶段耗时对照 · 版式样例' }, { kind: 'table', columns: ['阶段', '分钟'], rows: [['结构', '28'], ['文案', '42'], ['视觉', '18']] }], chart: { valueHeader: '分钟', points: [{ label: '结构', value: 28, display: '28' }, { label: '文案', value: 42, display: '42' }, { label: '视觉', value: 18, display: '18' }] }, note: '分钟 · 样例数据，非真实任务统计' } },
    { title: '查看横向对比', status: 'done', timestamp: '14:38', summary: '同一组字段用对比表呈现，而不是拆成三张文字卡。', previewType: 'document', previewData: { template: 'comparison', blocks: [{ kind: 'heading1', text: '协作方式对照 · 版式样例' }, { kind: 'table', columns: ['方案', '同步方式', '变化可见性'], rows: [['方案 A', '实时同步', '高'], ['方案 B', '定时同步', '中'], ['方案 C', '手动同步', '低']] }], note: '版式样例数据，仅用于展示结构，不代表任何真实产品。' } },
    { title: '查看现有视觉素材', status: 'done', timestamp: '14:40', summary: '预览仓库里已经存在的桌面背景素材。', previewType: 'image', artifactState: 'available', previewData: { src: './assets/ui/desktop-background.png', alt: '当前原型的桌面背景素材', note: '真实素材：desktop-background.png' } },
    { title: '核对产品资料', status: 'done', timestamp: '14:43', summary: '这里只显示两条来源入口。', previewType: 'reference', sources: [{ title: 'Figma 官网', url: 'https://www.figma.com/' }, { title: 'Linear 官网', url: 'https://linear.app/' }], previewData: { note: '来源条目 · 样例数据' } },
    { title: '等待导出转换', status: 'active', timestamp: '进行中', summary: '目前只有转换状态，没有生成任何新文件。', previewType: 'process', artifactState: 'pending', previewData: { detail: '正在整理页面内容；导出产物尚不可用。' } },
    { title: '查看已有页面文件', status: 'waiting', timestamp: '等待', summary: '文件卡仅展示仓库中已存在的原型页面。', previewType: 'file', artifactState: 'available', previewData: { path: 'new-conversation/index.html', label: '已存在于项目' } }
  ];

  window.GenUIPreview = Object.freeze({ normalizeStepPreview, renderStepPreview, demoSteps });
})();
