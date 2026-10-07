/* File artifacts use one constrained component; the stored path decides the type. */
(() => {
  const TYPES = {
    doc: ['word', 'Word 文档', 'W'], docx: ['word', 'Word 文档', 'W'],
    pdf: ['pdf', 'PDF 文档', 'PDF'],
    xls: ['sheet', 'Excel 工作簿', 'X'], xlsx: ['sheet', 'Excel 工作簿', 'X'], csv: ['sheet', 'CSV 数据表', 'CSV'],
    ppt: ['slides', 'PowerPoint 演示文稿', 'P'], pptx: ['slides', 'PowerPoint 演示文稿', 'P'],
    md: ['markdown', 'Markdown 文档', 'MD'], txt: ['text', '文本文档', 'TXT'],
    png: ['image', '图片', 'IMG'], jpg: ['image', '图片', 'IMG'], jpeg: ['image', '图片', 'IMG'], webp: ['image', '图片', 'IMG'], gif: ['image', '图片', 'IMG'], svg: ['image', '矢量图片', 'SVG'],
    html: ['code', 'HTML 页面', '</>'], htm: ['code', 'HTML 页面', '</>'], css: ['code', 'CSS 文件', '</>'], js: ['code', 'JavaScript 文件', '</>'], ts: ['code', 'TypeScript 文件', '</>'], json: ['code', 'JSON 数据', '{}'], py: ['code', 'Python 文件', '</>'],
    zip: ['archive', '压缩文件', 'ZIP'], rar: ['archive', '压缩文件', 'ZIP'], '7z': ['archive', '压缩文件', '7Z']
  };

  function makeArtifactFileName(title, extension, suffix = '') {
    const ext = String(extension || '').replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'txt';
    let base = String(title || '任务结果').normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
      .replace(/[·•—–]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.\s-]+|[.\s-]+$/g, '')
      .slice(0, 64) || '任务结果';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `任务-${base}`;
    const ending = String(suffix || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 24);
    return `${base}${ending ? `-${ending}` : ''}.${ext}`;
  }

  function normalizeFileArtifact(value) {
    if (!value || value.artifactState !== 'available') return null;
    const artifactPath = String(value.path || value.markdownPath || '').trim();
    if (!artifactPath) return null;
    const fileName = artifactPath.split(/[\\/]/).pop();
    const extension = fileName?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || '';
    if (!fileName || !extension) return null;
    const [kind, fileType, glyph] = TYPES[extension] || ['generic', `${extension.toUpperCase()} 文件`, 'FILE'];
    return { fileName, fileType, extension, kind, glyph, path: artifactPath };
  }

  function normalizeFilePreview(value) {
    if (!value || value.displayOnly !== true || value.path || value.markdownPath) return null;
    const fileName = String(value.fileName || '').trim();
    const extension = fileName.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || '';
    if (!fileName || !extension || fileName.includes('/') || fileName.includes('\\')) return null;
    const [kind, fileType, glyph] = TYPES[extension] || ['generic', `${extension.toUpperCase()} 文件`, 'FILE'];
    return { fileName, extension, kind, fileType, glyph };
  }

  function renderFilePreview(container, value, options = {}) {
    const artifact = normalizeFilePreview(value);
    container.replaceChildren();
    container.hidden = !artifact;
    if (!artifact) return null;
    container.classList.add('file-card');
    container.dataset.fileKind = artifact.kind;
    container.setAttribute('aria-label', `${artifact.fileName}，${artifact.fileType}`);
    const icon = document.createElement('span');
    icon.className = 'artifact-file-icon';
    icon.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('span');
    glyph.textContent = artifact.glyph;
    icon.append(glyph);
    const copy = document.createElement('span');
    copy.className = 'file-card-copy';
    const name = document.createElement('strong');
    name.textContent = artifact.fileName;
    const meta = document.createElement('span');
    meta.textContent = [options.label, artifact.fileType].filter(Boolean).join(' · ');
    copy.append(name, meta);
    container.append(icon, copy);
    return artifact;
  }

  function renderFileArtifact(container, value, options = {}) {
    const artifact = normalizeFileArtifact(value);
    container.replaceChildren();
    container.hidden = !artifact;
    if (!artifact) return null;
    container.classList.add('file-card');
    container.dataset.fileKind = artifact.kind;
    container.setAttribute('aria-label', `${artifact.fileName}，${artifact.fileType}，${artifact.path}`);

    const icon = document.createElement('span');
    icon.className = 'artifact-file-icon';
    icon.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('span');
    glyph.textContent = artifact.glyph;
    icon.append(glyph);

    const copy = document.createElement('span');
    copy.className = 'file-card-copy';
    const name = document.createElement('strong');
    name.textContent = artifact.fileName;
    const meta = document.createElement('span');
    meta.textContent = [options.label, artifact.fileType].filter(Boolean).join(' · ');
    copy.append(name, meta);

    const location = document.createElement('code');
    location.className = 'file-path';
    location.textContent = artifact.path;
    container.append(icon, copy, location);
    return artifact;
  }

  const api = Object.freeze({ makeArtifactFileName, normalizeFileArtifact, normalizeFilePreview, renderFileArtifact, renderFilePreview });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileArtifact = api;
})();
