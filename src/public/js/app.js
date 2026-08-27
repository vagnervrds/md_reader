(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const fileList = $('#file-list');
  const searchInput = $('#search-input');
  const viewer = $('#viewer');
  const topbarTitle = $('#topbar-title');
  const sidebar = $('#sidebar');
  const noResults = $('#no-results');
  const modalOverlay = $('#modal-themes');
  const themeGrid = $('#theme-grid');
  const themeSearchInput = $('#theme-search-input');
  const viewMode = $('#view-mode');
  const editModeEl = $('#edit-mode');
  const editorTextarea = $('#editor');
  const previewContent = $('#preview-content');
  const topbarStatus = $('#topbar-status');
  const btnEdit = $('#btn-edit');
  const btnSave = $('#btn-save');
  const btnView = $('#btn-view');
  const formatMenu = $('#format-menu');
  const sidebarTagsSection = $('#sidebar-tags-section');
  const sidebarTagsToggle = $('#sidebar-tags-toggle');
  const sidebarTagsBody = $('#sidebar-tags-body');
  const tagSearchInput = $('#tag-search-input');
  const tagChips = $('#tag-chips');
  const tagFilterBar = $('#tag-filter-bar');
  const tagFilterChip = $('#tag-filter-chip');
  const fileTagBar = $('#file-tag-bar');
  const fileTagInput = $('#file-tag-input');
  const folderModalOverlay = $('#modal-folders');
  const folderListEl = $('#folder-list');
  const folderEmptyEl = $('#folder-empty');

  let currentPath = null;
  let currentId = null;
  let searchTimeout = null;
  let themeSearchTimeout = null;
  let editMode = false;
  let isModified = false;
  let previewTimeout = null;

  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 200;
  let lastSnapshot = '';
  let snapshotTimeout = null;

  let communityThemes = [];
  let installedThemes = [];
  let activeThemeName = null;
  let currentTab = 'community';

  let allTags = [];
  let fileTagsMap = {};
  let activeTagFilter = null;
  let displayedFiles = [];
  let tagsExpanded = false;

  function toggleTagsSection() {
    tagsExpanded = !tagsExpanded;
    sidebarTagsBody.style.display = tagsExpanded ? '' : 'none';
    sidebarTagsToggle.classList.toggle('expanded', tagsExpanded);
    if (tagsExpanded) {
      tagSearchInput.value = '';
      filterTagChips('');
      tagSearchInput.focus();
    }
  }

  sidebarTagsToggle.addEventListener('click', toggleTagsSection);

  tagSearchInput.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  tagSearchInput.addEventListener('input', function () {
    filterTagChips(this.value);
  });

  tagChips.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  function filterTagChips(query) {
    const q = query.trim().toLowerCase();
    const chips = tagChips.querySelectorAll('.tag-chip');
    chips.forEach(function (chip) {
      const match = !q || chip.textContent.toLowerCase().indexOf(q) !== -1;
      chip.classList.toggle('hidden', !match);
    });
  }

  async function api(url, opts) {
    try {
      const res = await fetch(url, opts);
      return res.json();
    } catch (err) {
      return { error: `Falha de conexao com o servidor: ${err.message}` };
    }
  }

  async function loadTheme() {
    const themeSetting = await api('/api/settings/theme');
    const theme = themeSetting.value || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark';

    const activeSetting = await api('/api/themes/active');
    if (activeSetting.name) {
      activeThemeName = activeSetting.name;
      applyObsidianTheme(activeSetting.name);
    }

    updateHljsTheme();
  }

  function updateHljsTheme() {
    const theme = document.documentElement.getAttribute('data-theme');
    const hljsLink = $('#hljs-theme');
    hljsLink.href = theme === 'light'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css';
  }

  function applyObsidianTheme(name) {
    let link = document.getElementById('obsidian-theme-css');
    if (!name) {
      if (link) link.remove();
      return;
    }
    if (!link) {
      link = document.createElement('link');
      link.id = 'obsidian-theme-css';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      document.head.appendChild(link);
    }
    link.href = `/themes/${encodeURIComponent(name)}.css`;
  }

  function setTheme(theme, save) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark';
    updateHljsTheme();
    if (save) api('/api/settings/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: theme }) });
  }

  async function loadAllTags() {
    allTags = await api('/api/tags');
    renderTagChips();
  }

  async function loadAllFileTags() {
    const data = await api('/api/tags/all-file-tags');
    fileTagsMap = {};
    for (const ft of data) {
      if (!fileTagsMap[ft.filePath]) fileTagsMap[ft.filePath] = [];
      fileTagsMap[ft.filePath].push({ id: ft.tagId, name: ft.tagName, color: ft.tagColor });
    }
  }

  function renderTagChips() {
    tagChips.innerHTML = '';
    const usedTagIds = new Set();
    for (const tags of Object.values(fileTagsMap)) {
      for (const t of tags) usedTagIds.add(t.id);
    }
    const visibleTags = allTags.filter(t => usedTagIds.has(t.id));
    if (visibleTags.length === 0) {
      sidebarTagsSection.style.display = 'none';
      return;
    }
    sidebarTagsSection.style.display = '';
    for (const tag of visibleTags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip' + (activeTagFilter === tag.id ? ' active' : '');
      chip.style.background = tag.color;
      chip.textContent = tag.name;
      chip.addEventListener('click', () => {
        if (activeTagFilter === tag.id) {
          clearActiveTagFilter();
        } else {
          setActiveTagFilter(tag.id);
        }
      });
      tagChips.appendChild(chip);
    }
    if (tagSearchInput) {
      filterTagChips(tagSearchInput.value);
    }
  }

  function setActiveTagFilter(tagId) {
    activeTagFilter = tagId;
    const tag = allTags.find(t => t.id === tagId);
    if (tag) {
      tagFilterBar.style.display = 'flex';
      tagFilterChip.style.background = tag.color;
      tagFilterChip.textContent = tag.name;
    }
    renderTagChips();
    renderFilteredFileList();
  }

  function clearActiveTagFilter() {
    activeTagFilter = null;
    tagFilterBar.style.display = 'none';
    renderTagChips();
    renderFilteredFileList();
  }

  function renderFilteredFileList() {
    renderFileList(null);
  }

  async function loadRecentFiles() {
    const files = await api('/api/recent-files');
    renderFileList(files);
  }

  function renderFileList(files) {
    if (files) displayedFiles = files;

    let filtered = displayedFiles;
    if (activeTagFilter !== null) {
      filtered = displayedFiles.filter(f => {
        const tags = fileTagsMap[f.path] || [];
        return tags.some(t => t.id === activeTagFilter);
      });
    }

    fileList.innerHTML = '';
    noResults.hidden = true;
    if (filtered.length === 0) { noResults.hidden = false; return; }

    filtered.forEach((file) => {
      const li = document.createElement('li');
      if (file.path === currentPath) li.classList.add('active');
      const dir = file.path.replace(/[^\\/]+$/, '').slice(0, -1);
      const dirShort = dir.split(/[\\/]/).slice(-2).join('/');

      const tags = fileTagsMap[file.path] || [];
      const tagDotsHtml = tags.length > 0
        ? '<span class="file-tag-dots">' + tags.map(t => `<span class="tag-dot" style="background:${escapeHtml(t.color)}" title="${escapeHtml(t.name)}"></span>`).join('') + '</span>'
        : '';

      li.innerHTML = `
        <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="file-name">${escapeHtml(file.name)}<small>${escapeHtml(dirShort)}</small></span>
        ${tagDotsHtml}
      `;
      li.addEventListener('click', () => openFile(file.path));
      fileList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderFileTagBar() {
    if (!currentPath) {
      fileTagBar.style.display = 'none';
      return;
    }
    fileTagBar.style.display = 'flex';
    const tags = fileTagsMap[currentPath] || [];
    fileTagInput.value = tags.map(t => t.name).join(', ');
  }

  async function saveFileTags() {
    if (!currentPath) return;
    const raw = fileTagInput.value.trim();
    const tagNames = [...new Set(raw.split(/,+/).map(t => t.trim().toLowerCase()).filter(t => t.length > 0))];
    await api('/api/tags/set-file-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: currentPath, tags: tagNames })
    });
    await Promise.all([loadAllTags(), loadAllFileTags()]);
    renderFilteredFileList();
  }

  function enterEditMode(content) {
    editMode = true;
    isModified = false;
    viewMode.style.display = 'none';
    editModeEl.style.display = 'flex';
    btnEdit.style.display = 'none';
    btnSave.style.display = '';
    btnView.style.display = '';
    editorTextarea.value = content || '';
    undoStack.length = 0;
    redoStack.length = 0;
    lastSnapshot = editorTextarea.value;
    updatePreview();
    updateStatus();
    editorTextarea.focus();
  }

  function exitEditMode() {
    editMode = false;
    editModeEl.style.display = 'none';
    viewMode.style.display = '';
    btnEdit.style.display = '';
    btnSave.style.display = 'none';
    btnView.style.display = 'none';
    topbarStatus.textContent = '';
    hideFormatMenu();
  }

  function updatePreview() {
    const content = editorTextarea.value;
    if (typeof marked !== 'undefined' && marked.parse) {
      previewContent.innerHTML = marked.parse(content);
    } else {
      previewContent.innerHTML = '<p>Preview indisponivel</p>';
    }
    previewContent.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) window.hljs.highlightElement(block);
    });
  }

  function updateStatus() {
    if (!editMode) { topbarStatus.textContent = ''; return; }
    const lines = editorTextarea.value.split('\n').length;
    const chars = editorTextarea.value.length;
    const mod = isModified ? ' - Modificado' : '';
    topbarStatus.textContent = `${lines} linhas | ${chars} chars${mod}`;
  }

  async function saveFile() {
    if (!currentPath) { await saveAsFile(); return; }
    const content = editorTextarea.value;
    const result = await api('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, content })
    });
    if (result.error) { topbarStatus.textContent = 'Erro: ' + result.error; return; }
    isModified = false;
    updateStatus();
    topbarTitle.textContent = result.name;
    document.title = `${result.name} - mdreader`;
    loadRecentFiles();
  }

  async function saveAsFile() {
    const dialog = await api('/api/save-dialog');
    if (dialog.cancelled || !dialog.filePath) return;
    if (!dialog.filePath.toLowerCase().match(/\.(md|markdown)$/)) dialog.filePath += '.md';
    const content = editorTextarea.value;
    await api('/api/file-new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dialog.filePath }) });
    currentPath = dialog.filePath;
    const result = await api('/api/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath, content }) });
    if (result.error) { topbarStatus.textContent = 'Erro: ' + result.error; return; }
    isModified = false;
    topbarTitle.textContent = result.name;
    document.title = `${result.name} - mdreader`;
    updateStatus();
    loadRecentFiles();
  }

  async function newFile() {
    if (isModified && editMode) { if (!confirm('Arquivo modificado. Descartar?')) return; }
    currentPath = null;
    topbarTitle.textContent = 'Novo arquivo';
    document.title = 'Novo arquivo - mdreader';
    enterEditMode('');
  }

  async function openFile(filePath) {
    if (isModified && editMode) { if (!confirm('Arquivo modificado. Descartar?')) return; }
    currentPath = filePath;
    exitEditMode();
    const data = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
    if (data.error) { viewer.innerHTML = `<div class="welcome"><p>Erro: ${escapeHtml(data.error)}</p></div>`; return; }
    currentId = data.id || null;
    viewer.innerHTML = data.html;
    topbarTitle.textContent = data.name;
    document.title = `${data.name} - mdreader`;
    if (currentId) history.replaceState(null, '', `/file/${currentId}`);
    viewer.querySelectorAll('pre code').forEach((block) => { if (window.hljs) window.hljs.highlightElement(block); });
    loadRecentFiles();
    renderFileTagBar();
  }

  async function openFileById(id) {
    if (isModified && editMode) { if (!confirm('Arquivo modificado. Descartar?')) return; }
    exitEditMode();
    const data = await api(`/api/file/${id}`);
    if (data.error) { viewer.innerHTML = `<div class="welcome"><p>Erro: ${escapeHtml(data.error)}</p></div>`; return; }
    currentPath = data.path;
    currentId = data.id;
    viewer.innerHTML = data.html;
    topbarTitle.textContent = data.name;
    document.title = `${data.name} - mdreader`;
    history.replaceState(null, '', `/file/${data.id}`);
    viewer.querySelectorAll('pre code').forEach((block) => { if (window.hljs) window.hljs.highlightElement(block); });
    loadRecentFiles();
    renderFileTagBar();
  }

  async function reloadCurrentFile() {
    if (currentId) { await openFileById(currentId); }
    else if (currentPath) { await openFile(currentPath); }
  }

  async function searchFiles(query) {
    if (!query.trim()) { loadRecentFiles(); return; }
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    renderFileList(results);
    if (results.length === 0) noResults.hidden = false;
  }

  async function openFileDialog() {
    const data = await api('/api/open-dialog');
    if (data.error) { alert(data.error); return; }
    if (data.cancelled || !data.filePath) return;
    await openFile(data.filePath);
  }

  let formatMenuOpen = false;

  function showFormatMenu(x, y) {
    formatMenuOpen = true;
    formatMenu.style.display = 'block';
    const mw = formatMenu.offsetWidth;
    const mh = formatMenu.offsetHeight;
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    if (x + mw > ww) x = ww - mw - 8;
    if (y + mh > wh) y = wh - mh - 8;
    formatMenu.style.left = x + 'px';
    formatMenu.style.top = y + 'px';
  }

  function hideFormatMenu() {
    formatMenuOpen = false;
    formatMenu.style.display = 'none';
  }

  function saveSnapshot() {
    const val = editorTextarea.value;
    if (val === lastSnapshot) return;
    undoStack.push({ text: lastSnapshot, selStart: editorTextarea.selectionStart, selEnd: editorTextarea.selectionEnd });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = val;
  }

  function scheduleSnapshot() {
    clearTimeout(snapshotTimeout);
    snapshotTimeout = setTimeout(saveSnapshot, 400);
  }

  function forceSnapshot() {
    clearTimeout(snapshotTimeout);
    saveSnapshot();
  }

  function doUndo() {
    if (undoStack.length === 0) return;
    const current = editorTextarea.value;
    if (current !== lastSnapshot) {
      redoStack.push({ text: current, selStart: editorTextarea.selectionStart, selEnd: editorTextarea.selectionEnd });
    }
    const state = undoStack.pop();
    lastSnapshot = state.text;
    editorTextarea.value = state.text;
    editorTextarea.selectionStart = editorTextarea.selectionEnd = state.selStart;
    isModified = true;
    updateStatus();
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updatePreview, 150);
  }

  function doRedo() {
    if (redoStack.length === 0) return;
    const current = editorTextarea.value;
    if (current !== lastSnapshot) {
      undoStack.push({ text: current, selStart: editorTextarea.selectionStart, selEnd: editorTextarea.selectionEnd });
    }
    const state = redoStack.pop();
    lastSnapshot = state.text;
    editorTextarea.value = state.text;
    editorTextarea.selectionStart = editorTextarea.selectionEnd = state.selStart;
    isModified = true;
    updateStatus();
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updatePreview, 150);
  }

  function wrapSelection(before, after) {
    forceSnapshot();
    const start = editorTextarea.selectionStart;
    const end = editorTextarea.selectionEnd;
    const selected = editorTextarea.value.substring(start, end);
    const replacement = before + selected + after;
    editorTextarea.value = editorTextarea.value.substring(0, start) + replacement + editorTextarea.value.substring(end);
    editorTextarea.selectionStart = start + before.length;
    editorTextarea.selectionEnd = start + before.length + selected.length;
    editorTextarea.focus();
    editorTextarea.dispatchEvent(new Event('input'));
  }

  function insertAtCursor(text) {
    forceSnapshot();
    const start = editorTextarea.selectionStart;
    editorTextarea.value = editorTextarea.value.substring(0, start) + text + editorTextarea.value.substring(editorTextarea.selectionEnd);
    editorTextarea.selectionStart = editorTextarea.selectionEnd = start + text.length;
    editorTextarea.focus();
    editorTextarea.dispatchEvent(new Event('input'));
  }

  function insertLinePrefix(prefix) {
    forceSnapshot();
    const start = editorTextarea.selectionStart;
    const val = editorTextarea.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = val.indexOf('\n', start);
    const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
    const newLine = prefix + line;
    editorTextarea.value = val.substring(0, lineStart) + newLine + val.substring(lineEnd === -1 ? val.length : lineEnd);
    editorTextarea.selectionStart = editorTextarea.selectionEnd = lineStart + newLine.length;
    editorTextarea.focus();
    editorTextarea.dispatchEvent(new Event('input'));
  }

  function applyFormat(format) {
    const hasSelection = editorTextarea.selectionStart !== editorTextarea.selectionEnd;

    switch (format) {
      case 'bold': wrapSelection('**', '**'); if (!hasSelection) insertAtCursor(''); break;
      case 'italic': wrapSelection('*', '*'); break;
      case 'strike': wrapSelection('~~', '~~'); break;
      case 'code': wrapSelection('`', '`'); break;
      case 'link':
        if (hasSelection) { wrapSelection('[', '](url)'); }
        else { insertAtCursor('[texto](url)'); }
        break;
      case 'h1': insertLinePrefix('# '); break;
      case 'h2': insertLinePrefix('## '); break;
      case 'h3': insertLinePrefix('### '); break;
      case 'ul': insertLinePrefix('- '); break;
      case 'ol': insertLinePrefix('1. '); break;
      case 'check': insertLinePrefix('- [ ] '); break;
      case 'quote': insertLinePrefix('> '); break;
      case 'codeblock':
        if (hasSelection) { wrapSelection('\n```\n', '\n```\n'); }
        else { insertAtCursor('\n```\ncodigo\n```\n'); }
        break;
      case 'table': insertAtCursor('\n| Coluna 1 | Coluna 2 | Coluna 3 |\n|----------|----------|----------|\n|          |          |          |\n'); break;
      case 'hr': insertAtCursor('\n---\n'); break;
    }
    hideFormatMenu();
  }

  function openThemesModal() {
    modalOverlay.classList.add('active');
    currentTab = 'community';
    themeSearchInput.value = '';
    $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'community'));
    loadCommunityThemes();
  }

  function closeThemesModal() { modalOverlay.classList.remove('active'); }

  async function loadCommunityThemes() {
    themeGrid.innerHTML = '<div class="modal-loading"><div class="spinner"></div><br>Carregando temas...</div>';
    try {
      const [community, installed, active] = await Promise.all([api('/api/themes/community'), api('/api/themes/installed'), api('/api/themes/active')]);
      communityThemes = community || [];
      installedThemes = installed || [];
      activeThemeName = active.name || null;
      renderThemeGrid();
    } catch (err) { themeGrid.innerHTML = `<div class="modal-error">Erro: ${escapeHtml(err.message)}</div>`; }
  }

  async function loadInstalledThemes() {
    themeGrid.innerHTML = '<div class="modal-loading"><div class="spinner"></div><br>Carregando...</div>';
    try {
      const [installed, active] = await Promise.all([api('/api/themes/installed'), api('/api/themes/active')]);
      installedThemes = installed || [];
      activeThemeName = active.name || null;
      renderThemeGrid();
    } catch (err) { themeGrid.innerHTML = `<div class="modal-error">Erro: ${escapeHtml(err.message)}</div>`; }
  }

  function buildScreenshotUrl(theme) {
    if (!theme.screenshot || !theme.repo) return null;
    return `https://raw.githubusercontent.com/${theme.repo}/${theme.branch || 'master'}/${theme.screenshot}`;
  }

  function renderThemeGrid() {
    const query = themeSearchInput.value.toLowerCase().trim();
    themeGrid.innerHTML = '';
    let themes;
    if (currentTab === 'community') {
      themes = communityThemes;
      if (query) themes = themes.filter(t => t.name.toLowerCase().includes(query) || (t.author && t.author.toLowerCase().includes(query)));
    } else {
      themes = installedThemes;
      if (query) themes = themes.filter(t => t.name.toLowerCase().includes(query));
    }
    if (themes.length === 0) { themeGrid.innerHTML = '<div class="modal-error">Nenhum tema encontrado</div>'; return; }

    themes.forEach((theme) => {
      const isInstalled = currentTab === 'community' ? installedThemes.some(i => i.name === theme.name) : true;
      const isActive = theme.name === activeThemeName;
      const card = document.createElement('div');
      card.className = 'theme-card' + (isActive ? ' active-theme' : '');

      const modes = theme.modes || [];
      const modesHtml = modes.length > 0 ? '<div class="theme-card-modes">' + modes.map(m => `<span class="theme-mode-tag">${m}</span>`).join('') + '</div>' : '';
      const screenshotUrl = buildScreenshotUrl(theme);
      const imgHtml = screenshotUrl
        ? `<img class="theme-card-img" src="${escapeHtml(screenshotUrl)}" alt="${escapeHtml(theme.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'theme-card-placeholder\\'>${escapeHtml(theme.name)}</div>'">`
        : `<div class="theme-card-placeholder">${escapeHtml(theme.name)}</div>`;

      let actionsHtml = '';
      if (isActive) actionsHtml = '<span class="btn-sm btn-active">Ativo</span><button class="btn-sm btn-uninstall" data-action="uninstall" data-name="' + escapeHtml(theme.name) + '">Excluir</button>';
      else if (currentTab === 'installed') actionsHtml = '<button class="btn-sm btn-apply" data-action="apply" data-name="' + escapeHtml(theme.name) + '">Aplicar</button><button class="btn-sm btn-uninstall" data-action="uninstall" data-name="' + escapeHtml(theme.name) + '">Excluir</button>';
      else if (isInstalled) actionsHtml = '<button class="btn-sm btn-apply" data-action="apply" data-name="' + escapeHtml(theme.name) + '">Aplicar</button>';
      else actionsHtml = '<button class="btn-sm btn-install" data-action="install" data-repo="' + escapeHtml(theme.repo) + '" data-branch="' + escapeHtml(theme.branch || '') + '" data-name="' + escapeHtml(theme.name) + '">Instalar</button>';

      card.innerHTML = `${imgHtml}<div class="theme-card-body"><div class="theme-card-name">${escapeHtml(theme.name)}</div>${theme.author ? '<div class="theme-card-author">' + escapeHtml(theme.author) + '</div>' : ''}${modesHtml}<div class="theme-card-actions">${actionsHtml}</div></div>`;
      themeGrid.appendChild(card);
    });

    themeGrid.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const name = btn.dataset.name;
        if (action === 'install') {
          btn.textContent = 'Instalando...'; btn.disabled = true;
          const result = await api('/api/themes/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: btn.dataset.repo, branch: btn.dataset.branch || null, name }) });
          if (result.error) { btn.textContent = 'Erro'; btn.title = result.error; }
          else { installedThemes.push({ name, file: `${name}.css` }); renderThemeGrid(); }
        }
        if (action === 'apply') {
          btn.textContent = 'Aplicando...'; btn.disabled = true;
          await api('/api/themes/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
          activeThemeName = name; applyObsidianTheme(name); renderThemeGrid();
        }
        if (action === 'uninstall') {
          btn.textContent = 'Removendo...'; btn.disabled = true;
          await api(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' });
          if (activeThemeName === name) { activeThemeName = null; applyObsidianTheme(null); }
          installedThemes = installedThemes.filter(t => t.name !== name);
          renderThemeGrid();
        }
      });
    });
  }

  function openFoldersModal() {
    folderModalOverlay.classList.add('active');
    loadFolders();
  }

  function closeFoldersModal() {
    folderModalOverlay.classList.remove('active');
  }

  async function loadFolders() {
    const folders = await api('/api/folders');
    folderListEl.innerHTML = '';
    folderEmptyEl.style.display = folders.length === 0 ? 'block' : 'none';

    for (const folder of folders) {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `
        <div class="folder-item-path">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ${escapeHtml(folder.path)}
        </div>
        <div class="folder-item-info">
          <span>${folder.fileCount} arquivo(s)</span>
          ${folder.lastScanned ? '<span>Atualizado: ' + new Date(folder.lastScanned).toLocaleTimeString('pt-BR') + '</span>' : ''}
        </div>
        <div class="folder-item-actions">
          <label class="folder-toggle">
            <input type="checkbox" data-folder-id="${folder.id}" data-field="includeSubfolders" ${folder.includeSubfolders ? 'checked' : ''}>
            Subpastas
          </label>
          <label class="folder-toggle">
            <input type="checkbox" data-folder-id="${folder.id}" data-field="active" ${folder.active ? 'checked' : ''}>
            Ativo
          </label>
          <button class="btn-folder-action" data-action="scan" data-folder-id="${folder.id}">Escanear</button>
          <button class="btn-folder-action btn-danger" data-action="remove" data-folder-id="${folder.id}">Remover</button>
        </div>
      `;
      folderListEl.appendChild(item);
    }

    folderListEl.querySelectorAll('.folder-toggle input').forEach(cb => {
      cb.addEventListener('change', async () => {
        await api(`/api/folders/${cb.dataset.folderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [cb.dataset.field]: cb.checked })
        });
      });
    });

    folderListEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const folderId = btn.dataset.folderId;
        if (action === 'scan') {
          btn.textContent = 'Scaneando...';
          btn.disabled = true;
          await api('/api/folders/scan', { method: 'POST' });
          loadFolders();
          loadRecentFiles();
        }
        if (action === 'remove') {
          if (!confirm('Remover pasta monitorada?')) return;
          await api(`/api/folders/${folderId}`, { method: 'DELETE' });
          loadFolders();
          loadRecentFiles();
        }
      });
    });
  }

  async function addFolder() {
    const data = await api('/api/folder-dialog');
    if (data.error) { alert(data.error); return; }
    if (data.cancelled || !data.folderPath) return;
    const result = await api('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: data.folderPath, includeSubfolders: false })
    });
    if (result.error) { alert(result.error); return; }
    loadFolders();
  }

  $('#btn-open').addEventListener('click', openFileDialog);
  $('#btn-new').addEventListener('click', newFile);

  $('#btn-edit').addEventListener('click', async () => {
    if (!currentPath) { enterEditMode(''); return; }
    const data = await api(`/api/file-raw?path=${encodeURIComponent(currentPath)}`);
    if (data.error) { topbarStatus.textContent = data.error; return; }
    enterEditMode(data.content);
  });

  $('#btn-save').addEventListener('click', saveFile);

  $('#btn-view').addEventListener('click', async () => {
    if (currentPath) {
      const content = editorTextarea.value;
      await api('/api/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath, content }) });
    }
    exitEditMode();
    if (currentPath) await openFile(currentPath);
  });

  editorTextarea.addEventListener('input', () => {
    isModified = true;
    updateStatus();
    scheduleSnapshot();
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(updatePreview, 300);
  });

  editorTextarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && e.shiftKey) { e.preventDefault(); doRedo(); return; }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); doRedo(); return; }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      forceSnapshot();
      const s = editorTextarea.selectionStart;
      editorTextarea.value = editorTextarea.value.substring(0, s) + '  ' + editorTextarea.value.substring(editorTextarea.selectionEnd);
      editorTextarea.selectionStart = editorTextarea.selectionEnd = s + 2;
      editorTextarea.dispatchEvent(new Event('input'));
    }
  });

  editorTextarea.addEventListener('contextmenu', (e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (!formatMenuOpen) showFormatMenu(e.clientX, e.clientY);
  });

  editorTextarea.addEventListener('mouseup', (e) => {
    if (!editMode) return;
    setTimeout(() => {
      const hasSelection = editorTextarea.selectionStart !== editorTextarea.selectionEnd;
      if (hasSelection) {
        e.preventDefault();
        const rect = editorTextarea.getBoundingClientRect();
        const lineH = parseFloat(getComputedStyle(editorTextarea).lineHeight) || 24;
        const pos = getCaretPixelPos();
        showFormatMenu(pos.x + rect.left + 20, pos.y + rect.top - 10);
      }
    }, 10);
  });

  function getCaretPixelPos() {
    const div = document.createElement('div');
    const computed = getComputedStyle(editorTextarea);
    const style = div.style;
    style.position = 'absolute';
    style.visibility = 'hidden';
    style.whiteSpace = 'pre-wrap';
    style.wordWrap = 'break-word';
    style.font = computed.font;
    style.letterSpacing = computed.letterSpacing;
    style.padding = computed.padding;
    style.width = computed.width;
    style.height = computed.height;
    style.border = computed.border;
    style.lineHeight = computed.lineHeight;

    const textBefore = editorTextarea.value.substring(0, editorTextarea.selectionStart);
    const textNode = document.createTextNode(textBefore);
    div.appendChild(textNode);

    const span = document.createElement('span');
    span.textContent = '|';
    div.appendChild(span);

    document.body.appendChild(div);
    const x = span.offsetLeft - editorTextarea.scrollLeft;
    const y = span.offsetTop - editorTextarea.scrollTop;
    document.body.removeChild(div);

    return { x, y };
  }

  formatMenu.querySelectorAll('[data-format]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyFormat(btn.dataset.format);
    });
  });

  document.addEventListener('click', (e) => {
    if (!formatMenu.contains(e.target)) hideFormatMenu();
  });

  document.addEventListener('contextmenu', (e) => {
    if (formatMenuOpen && e.target === editorTextarea) {
      e.preventDefault();
    }
  });

  $('#btn-theme').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark', true);
  });

  $('#btn-toggle-sidebar').addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  $('#btn-open-themes').addEventListener('click', openThemesModal);
  $('#modal-close').addEventListener('click', closeThemesModal);
  $('#btn-reload').addEventListener('click', reloadCurrentFile);

  $('#btn-open-folders').addEventListener('click', openFoldersModal);
  $('#modal-folders-close').addEventListener('click', closeFoldersModal);
  folderModalOverlay.addEventListener('click', (e) => { if (e.target === folderModalOverlay) closeFoldersModal(); });

  $('#btn-add-folder').addEventListener('click', addFolder);

  fileTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveFileTags();
      fileTagInput.blur();
    }
  });

  fileTagInput.addEventListener('blur', () => {
    saveFileTags();
  });

  $('#tag-filter-clear').addEventListener('click', clearActiveTagFilter);

  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeThemesModal(); });

  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      $$('.modal-tab').forEach(t => t.classList.toggle('active', t === tab));
      themeSearchInput.value = '';
      currentTab === 'community' ? loadCommunityThemes() : loadInstalledThemes();
    });
  });

  searchInput.addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => searchFiles(searchInput.value), 250); });
  themeSearchInput.addEventListener('input', () => { clearTimeout(themeSearchTimeout); themeSearchTimeout = setTimeout(renderThemeGrid, 200); });

  document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (const file of e.dataTransfer.files) {
      if (file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown')) { openFile(file.path); break; }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOverlay.classList.contains('active')) closeThemesModal();
      else if (folderModalOverlay.classList.contains('active')) closeFoldersModal();
      else if (formatMenu.style.display !== 'none') hideFormatMenu();
    }
    if (e.ctrlKey && e.key === 's' && editMode) { e.preventDefault(); saveFile(); }
  });

  loadTheme();
  loadAllTags();
  loadAllFileTags();
  loadRecentFiles();

  const fileMatch = window.location.pathname.match(/^\/file\/(\d+)$/);
  if (fileMatch) {
    openFileById(fileMatch[1]);
  }
})();
