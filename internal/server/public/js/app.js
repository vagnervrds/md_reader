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
  const settingsModalOverlay = $('#modal-settings');
  const assocStatusBadge = $('#assoc-status-badge');
  const assocExePath = $('#assoc-exe-path');
  const btnRegisterAssoc = $('#btn-register-assoc');
  const btnUnregisterAssoc = $('#btn-unregister-assoc');
  const linkOpenDefaultApps = $('#link-open-defaultapps');

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
        <button class="btn-remove-item" title="Remover do banco de dados" data-id="${file.id}" data-path="${escapeHtml(file.path)}">&times;</button>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-item')) return;
        openFile(file.path);
      });
      const btnRemoveItem = li.querySelector('.btn-remove-item');
      if (btnRemoveItem) {
        btnRemoveItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFileFromDb(file.path, file.id);
        });
      }
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

  function renderFileNotFound(filePath, fileId, fileName, errorMsg) {
    currentPath = filePath || null;
    currentId = fileId || null;
    fileTagBar.style.display = 'none';

    const displayName = fileName || (filePath ? filePath.split(/[\\/]/).pop() : 'Arquivo não encontrado');
    topbarTitle.textContent = displayName;
    document.title = `${displayName} - Arquivo não encontrado`;

    const displayPath = filePath || '(Endereço não disponível no disco)';
    const displayError = errorMsg || 'Arquivo não encontrado no disco';

    viewer.innerHTML = `
      <div class="file-not-found-card">
        <div class="file-not-found-header">
          <div class="file-not-found-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div class="file-not-found-title-group">
            <h2>${escapeHtml(displayError)}</h2>
            <p>O arquivo não existe mais neste local no disco (pode ter sido excluído, renomeado ou movido).</p>
          </div>
        </div>

        <div class="file-not-found-path-box">
          <span class="file-not-found-path-label">Endereço onde o arquivo estava no disco:</span>
          <div class="file-not-found-path-value" id="not-found-path-text">${escapeHtml(displayPath)}</div>
        </div>

        <div class="file-not-found-actions">
          <button class="btn-remove-db" id="btn-remove-file-db">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            Apagar do banco de dados
          </button>
          <button class="btn-copy-path" id="btn-copy-not-found-path" title="Copiar endereço completo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copiar endereço
          </button>
        </div>
      </div>
    `;

    const btnRemove = $('#btn-remove-file-db');
    if (btnRemove) {
      btnRemove.addEventListener('click', async () => {
        btnRemove.disabled = true;
        btnRemove.textContent = 'Removendo...';
        await removeFileFromDb(filePath, fileId);
      });
    }

    const btnCopy = $('#btn-copy-not-found-path');
    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(displayPath);
          btnCopy.textContent = 'Copiado!';
          setTimeout(() => {
            btnCopy.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copiar endereço
            `;
          }, 2000);
        } catch (e) {
          // fallback
        }
      });
    }
  }

  async function removeFileFromDb(filePath, fileId) {
    const res = await api('/api/file-db', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, id: fileId })
    });

    if (res.error) {
      alert(`Erro ao remover do banco de dados: ${res.error}`);
      return;
    }

    currentPath = null;
    currentId = null;
    topbarTitle.textContent = 'mdreader';
    document.title = 'mdreader';
    history.replaceState(null, '', '/');

    await Promise.all([loadRecentFiles(), loadAllTags(), loadAllFileTags()]);
    renderTagChips();

    viewer.innerHTML = `
      <div class="welcome">
        <img src="/icon-192.png" alt="mdreader" class="welcome-icon">
        <h2>mdreader</h2>
        <p>Arquivo removido do banco de dados com sucesso.</p>
        <div class="welcome-actions">
          <button class="welcome-btn" id="welcome-btn-open">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>
            Abrir arquivo
          </button>
          <button class="welcome-btn" id="welcome-btn-new">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Novo arquivo
          </button>
        </div>
      </div>
    `;
  }

  async function openFile(filePath) {
    if (!filePath || filePath.toLowerCase().includes('snapshot')) return;
    if (isModified && editMode) { if (!confirm('Arquivo modificado. Descartar?')) return; }
    currentPath = filePath;
    exitEditMode();
    const data = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
    if (data.notFound || data.error || (data.html && data.html.includes('source-code-not-available'))) {
      renderFileNotFound(data.path || filePath, data.id || null, data.name || '', data.error || 'Arquivo não encontrado no disco');
      return;
    }
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
    if (data.notFound || data.error || (data.html && data.html.includes('source-code-not-available')) || (data.path && data.path.toLowerCase().includes('snapshot'))) {
      renderFileNotFound(data.path || '', data.id || id, data.name || '', data.error || 'Arquivo não encontrado no disco');
      return;
    }
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

  function openSettingsModal() {
    settingsModalOverlay.classList.add('active');
    loadAssociationStatus();
  }

  function closeSettingsModal() {
    settingsModalOverlay.classList.remove('active');
  }

  async function loadAssociationStatus() {
    assocStatusBadge.textContent = 'Verificando...';
    assocStatusBadge.className = 'settings-badge';
    btnRegisterAssoc.disabled = true;
    btnUnregisterAssoc.disabled = true;

    const data = await api('/api/association/status');
    btnRegisterAssoc.disabled = false;
    btnUnregisterAssoc.disabled = false;

    if (data.error || !data.supported) {
      assocStatusBadge.textContent = data.message || 'Não suportado';
      assocStatusBadge.className = 'settings-badge badge-warning';
      assocExePath.textContent = data.exePath || '-';
      btnRegisterAssoc.style.display = 'none';
      btnUnregisterAssoc.style.display = 'none';
      return;
    }

    assocExePath.textContent = data.exePath || 'Não identificado';

    if (data.isAssociated) {
      assocStatusBadge.textContent = 'Associado como leitor padrão';
      assocStatusBadge.className = 'settings-badge badge-success';
      btnRegisterAssoc.textContent = 'Reaplicar Associação';
      btnRegisterAssoc.style.display = '';
      btnUnregisterAssoc.style.display = '';
    } else {
      assocStatusBadge.textContent = 'Não associado';
      assocStatusBadge.className = 'settings-badge badge-warning';
      btnRegisterAssoc.textContent = 'Definir como Leitor Padrão';
      btnRegisterAssoc.style.display = '';
      btnUnregisterAssoc.style.display = 'none';
    }
  }

  async function registerAssociation() {
    btnRegisterAssoc.textContent = 'Registrando...';
    btnRegisterAssoc.disabled = true;
    const res = await api('/api/association/register', { method: 'POST' });
    btnRegisterAssoc.disabled = false;
    if (res.error) {
      alert(`Erro ao associar arquivo: ${res.error}`);
    }
    await loadAssociationStatus();
  }

  async function unregisterAssociation() {
    if (!confirm('Deseja remover o mdreader como leitor padrão para arquivos .md?')) return;
    btnUnregisterAssoc.textContent = 'Removendo...';
    btnUnregisterAssoc.disabled = true;
    const res = await api('/api/association/unregister', { method: 'POST' });
    btnUnregisterAssoc.disabled = false;
    if (res.error) {
      alert(`Erro ao desassociar arquivo: ${res.error}`);
    }
    await loadAssociationStatus();
  }

  $('#btn-open').addEventListener('click', openFileDialog);
  $('#btn-new').addEventListener('click', newFile);

  document.addEventListener('click', (e) => {
    if (e.target.closest('#welcome-btn-open')) {
      openFileDialog();
    } else if (e.target.closest('#welcome-btn-new')) {
      newFile();
    }
  });

  $('#btn-edit').addEventListener('click', async () => {
    if (!currentPath) { enterEditMode(''); return; }
    const data = await api(`/api/file-raw?path=${encodeURIComponent(currentPath)}`);
    if (data.notFound || data.error) {
      renderFileNotFound(data.path || currentPath, currentId, topbarTitle.textContent, data.error);
      return;
    }
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

  $('#btn-open-settings').addEventListener('click', openSettingsModal);
  $('#modal-settings-close').addEventListener('click', closeSettingsModal);
  settingsModalOverlay.addEventListener('click', (e) => { if (e.target === settingsModalOverlay) closeSettingsModal(); });

  btnRegisterAssoc.addEventListener('click', registerAssociation);
  btnUnregisterAssoc.addEventListener('click', unregisterAssociation);
  linkOpenDefaultApps.addEventListener('click', (e) => {
    e.preventDefault();
    api('/api/association/open-settings', { method: 'POST' });
  });

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

  function pathResolve(baseDir, relPath) {
    const isWin = baseDir.includes('\\') || /^[a-zA-Z]:/.test(baseDir);
    const sep = isWin ? '\\' : '/';
    const cleanBase = baseDir.replace(/[\\/]+$/, '');
    const parts = cleanBase.split(/[\\/]/);
    const relParts = relPath.split(/[\\/]/);

    for (const p of relParts) {
      if (!p || p === '.') continue;
      if (p === '..') {
        if (parts.length > 1) parts.pop();
      } else {
        parts.push(p);
      }
    }
    return parts.join(sep);
  }

  viewer.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;

    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      return;
    }

    if (href.startsWith('#')) return;

    e.preventDefault();
    let targetPath = href;
    if (currentPath && !/^[a-zA-Z]:[\\/]/.test(href) && !href.startsWith('/')) {
      const baseDir = currentPath.replace(/[^\\/]+$/, '');
      targetPath = pathResolve(baseDir, href);
    }
    openFile(targetPath);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOverlay.classList.contains('active')) closeThemesModal();
      else if (folderModalOverlay.classList.contains('active')) closeFoldersModal();
      else if (settingsModalOverlay.classList.contains('active')) closeSettingsModal();
      else if (formatMenu.style.display !== 'none') hideFormatMenu();
    }
    if (e.ctrlKey && e.key === 's' && editMode) { e.preventDefault(); saveFile(); }
  });

  loadTheme();
  loadAllTags();
  loadAllFileTags();
  loadRecentFiles();

  const urlParams = new URLSearchParams(window.location.search);
  const initialFilePath = urlParams.get('file');
  if (initialFilePath && !initialFilePath.toLowerCase().includes('snapshot')) {
    openFile(initialFilePath);
  } else {
    const fileMatch = window.location.pathname.match(/^\/file\/(\d+)$/);
    if (fileMatch) {
      openFileById(fileMatch[1]);
    }
  }
})();
