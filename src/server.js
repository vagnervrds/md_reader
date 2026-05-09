const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const hljs = require('highlight.js');
const RecentFile = require('./database/models/RecentFile');
const Setting = require('./database/models/Setting');
const MonitoredFolder = require('./database/models/MonitoredFolder');
const IndexedFile = require('./database/models/IndexedFile');
const Tag = require('./database/models/Tag');
const FileTag = require('./database/models/FileTag');
const log = require('./logger');
const scannerBridge = require('./scanner-bridge');

const TAG_COLORS = ['#6c8cff', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63', '#00bcd4'];

function getTagColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  }
}));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getAppDir() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..');
}

const THEMES_DIR = path.join(getAppDir(), 'themes');
const COMMUNITY_THEMES_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json';

if (!fs.existsSync(THEMES_DIR)) {
  fs.mkdirSync(THEMES_DIR, { recursive: true });
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      log.info(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mdreader' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

let communityThemesCache = null;
let communityThemesCacheTime = 0;

app.get('/api/themes/community', async (req, res) => {
  try {
    const now = Date.now();
    if (communityThemesCache && (now - communityThemesCacheTime) < 300000) {
      return res.json(communityThemesCache);
    }

    const themes = await fetchJson(COMMUNITY_THEMES_URL);
    communityThemesCache = themes;
    communityThemesCacheTime = now;
    log.info('Community themes fetched', { count: themes.length });
    res.json(themes);
  } catch (err) {
    log.error('Failed to fetch community themes', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/themes/installed', async (req, res) => {
  try {
    const installed = [];
    const files = fs.readdirSync(THEMES_DIR).filter(f => f.endsWith('.css'));

    for (const file of files) {
      const themeName = file.replace('.css', '');
      const stat = fs.statSync(path.join(THEMES_DIR, file));
      installed.push({ name: themeName, file, installedAt: stat.mtime });
    }

    res.json(installed);
  } catch (err) {
    log.error('Failed to list installed themes', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mdreader' } }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(null));
  });
}

async function fetchThemeCss(repo, branch) {
  const branches = branch ? [branch] : ['master', 'main'];
  const files = ['obsidian.css', 'theme.css'];

  for (const br of branches) {
    for (const file of files) {
      const url = `https://raw.githubusercontent.com/${repo}/${br}/${file}`;
      const content = await fetchUrl(url);
      if (content) return content;
    }
  }
  return null;
}

app.post('/api/themes/install', async (req, res) => {
  try {
    const { repo, branch, name } = req.body;
    if (!repo || !name) {
      return res.status(400).json({ error: 'repo and name are required' });
    }

    log.info('Installing theme', { name, repo, branch });
    const themePath = path.join(THEMES_DIR, `${name}.css`);
    const cssContent = await fetchThemeCss(repo, branch || null);

    if (!cssContent) {
      log.warn('Theme CSS not found', { name, repo });
      return res.status(404).json({ error: 'Theme CSS not found in repository' });
    }

    fs.writeFileSync(themePath, cssContent, 'utf-8');
    log.info('Theme installed', { name, size: cssContent.length });
    res.json({ success: true, name, file: `${name}.css` });
  } catch (err) {
    log.error('Failed to install theme', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/themes/:name', async (req, res) => {
  try {
    const themePath = path.join(THEMES_DIR, `${req.params.name}.css`);
    if (!fs.existsSync(themePath)) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    const activeSetting = await Setting.findByPk('active_theme');
    if (activeSetting && activeSetting.value === req.params.name) {
      await Setting.upsert({ key: 'active_theme', value: '' });
    }

    fs.unlinkSync(themePath);
    log.info('Theme removed', { name: req.params.name });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to remove theme', { name: req.params.name, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/themes/active', async (req, res) => {
  try {
    const setting = await Setting.findByPk('active_theme');
    res.json({ name: setting ? setting.value : null });
  } catch (err) {
    log.error('Failed to get active theme', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/themes/active', async (req, res) => {
  try {
    const { name } = req.body;
    if (name) {
      const themePath = path.join(THEMES_DIR, `${name}.css`);
      if (!fs.existsSync(themePath)) {
        return res.status(404).json({ error: 'Theme not installed' });
      }
    }
    await Setting.upsert({ key: 'active_theme', value: name || '' });
    log.info('Active theme set', { name: name || 'none' });
    res.json({ success: true, name: name || null });
  } catch (err) {
    log.error('Failed to set active theme', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/themes/:name.css', (req, res) => {
  const themePath = path.join(THEMES_DIR, `${req.params.name}.css`);
  if (!fs.existsSync(themePath)) {
    return res.status(404).send('Not found');
  }
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(themePath);
});

app.get('/api/file-raw', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const content = fs.readFileSync(filePath, 'utf-8');
    log.info('File raw loaded', { path: filePath });
    res.json({ content });
  } catch (err) {
    log.error('Failed to read file raw', { path: req.query.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/file', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content are required' });

    fs.writeFileSync(filePath, content, 'utf-8');

    const name = path.basename(filePath);
    const html = marked.parse(content);

    const existing = await RecentFile.findOne({ where: { path: filePath } });
    if (existing) {
      await existing.update({ last_opened: new Date() });
    } else {
      await RecentFile.create({ path: filePath, name });
    }

    log.info('File saved', { path: filePath, size: content.length });
    res.json({ success: true, name, html });
  } catch (err) {
    log.error('Failed to save file', { path: req.body.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/file-new', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    fs.writeFileSync(filePath, '', 'utf-8');

    const name = path.basename(filePath);
    await RecentFile.create({ path: filePath, name });

    log.info('New file created', { path: filePath });
    res.json({ success: true, name, path: filePath });
  } catch (err) {
    log.error('Failed to create file', { path: req.body.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/save-dialog', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    if (process.platform !== 'win32') return res.status(501).json({ error: 'Not supported' });

    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Markdown Files|*.md;*.markdown|All Files|*.*'; $d.Title = 'Salvar como'; $d.FileName = 'novo_arquivo.md'; if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { '' }`;
    const fullCmd = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${psCmd}`;
    const filePath = execSync(`powershell -NoProfile -Command "${fullCmd.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();

    if (!filePath) {
      log.info('Save dialog cancelled');
      return res.json({ cancelled: true });
    }
    log.info('Save dialog selected', { path: filePath });
    res.json({ filePath });
  } catch (err) {
    log.error('Save dialog failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recent-files', async (req, res) => {
  try {
    const files = await RecentFile.findAll({
      order: [['last_opened', 'DESC']],
      limit: 50
    });
    res.json(files);
  } catch (err) {
    log.error('Failed to list recent files', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recent-files', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });

    const name = path.basename(filePath);
    const file = await RecentFile.findOne({ where: { path: filePath } });

    if (file) {
      await file.update({ last_opened: new Date() });
      res.json(file);
    } else {
      const newFile = await RecentFile.create({ path: filePath, name });
      res.json(newFile);
    }
  } catch (err) {
    log.error('Failed to update recent file', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recent-files/:id', async (req, res) => {
  try {
    await RecentFile.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to remove recent file', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    if (!fs.existsSync(filePath)) {
      log.warn('File not found', { path: filePath });
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const html = marked.parse(content);

    const name = path.basename(filePath);
    const existing = await RecentFile.findOne({ where: { path: filePath } });
    if (existing) {
      await existing.update({ last_opened: new Date() });
      res.json({ id: existing.id, name, path: filePath, html });
    } else {
      const newFile = await RecentFile.create({ path: filePath, name });
      res.json({ id: newFile.id, name, path: filePath, html });
    }

    log.info('File opened', { path: filePath, size: content.length });
  } catch (err) {
    log.error('Failed to open file', { path: req.query.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file/:id', async (req, res) => {
  try {
    const file = await RecentFile.findByPk(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found in database' });

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    const content = fs.readFileSync(file.path, 'utf-8');
    const html = marked.parse(content);

    await file.update({ last_opened: new Date() });

    log.info('File opened by id', { id: file.id, path: file.path, size: content.length });
    res.json({ id: file.id, name: file.name, path: file.path, html });
  } catch (err) {
    log.error('Failed to open file by id', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/file/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    if (!q) return res.json([]);

    const allFiles = await RecentFile.findAll({ order: [['last_opened', 'DESC']] });

    const results = [];
    for (const file of allFiles) {
      const nameMatch = file.name.toLowerCase().includes(q);
      let contentMatch = false;

      if (fs.existsSync(file.path)) {
        try {
          const content = fs.readFileSync(file.path, 'utf-8').toLowerCase();
          contentMatch = content.includes(q);
        } catch (readErr) {
          log.warn('Failed to read file for search', { path: file.path, error: readErr.message });
        }
      }

      if (nameMatch || contentMatch) {
        results.push({
          id: file.id,
          name: file.name,
          path: file.path,
          last_opened: file.last_opened,
          matchType: nameMatch && contentMatch ? 'both' : nameMatch ? 'name' : 'content'
        });
      }
    }

    log.info('Search performed', { query: q, results: results.length });
    res.json(results);
  } catch (err) {
    log.error('Search failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const setting = await Setting.findByPk(req.params.key);
    res.json({ key: req.params.key, value: setting ? setting.value : null });
  } catch (err) {
    log.error('Failed to get setting', { key: req.params.key, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await Setting.upsert({ key: req.params.key, value });
    log.info('Setting updated', { key: req.params.key });
    res.json({ key: req.params.key, value });
  } catch (err) {
    log.error('Failed to update setting', { key: req.params.key, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/open-dialog', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const isWindows = process.platform === 'win32';

    let filePath;
    if (isWindows) {
      const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Markdown Files|*.md;*.markdown|All Files|*.*'; $d.Title = 'Open Markdown File'; if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { '' }`;
      const fullCmd = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${psCmd}`;
      filePath = execSync(`powershell -NoProfile -Command "${fullCmd.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();
    } else {
      return res.status(501).json({ error: 'Dialog not supported on this platform' });
    }

    if (!filePath) {
      log.info('Open dialog cancelled');
      return res.json({ cancelled: true });
    }
    log.info('Open dialog selected', { path: filePath });
    res.json({ filePath });
  } catch (err) {
    log.error('Open dialog failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/folder-dialog', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    if (process.platform !== 'win32') return res.status(501).json({ error: 'Not supported' });

    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.ValidateNames = $false; $d.CheckFileExists = $false; $d.CheckPathExists = $false; $d.FileName = 'Cole o caminho da pasta aqui'; $d.Title = 'Selecionar pasta para monitorar'; $d.Filter = 'Todos|*.*'; if ($d.ShowDialog() -eq 'OK') { $p = $d.FileName; if (Test-Path -LiteralPath $p -PathType Container) { $p } elseif (Test-Path -LiteralPath (Split-Path $p) -PathType Container) { Split-Path $p } else { $p } } else { '' }`;
    const fullCmd = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${psCmd}`;
    const folderPath = execSync(`powershell -NoProfile -Command "${fullCmd.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();

    if (!folderPath) {
      return res.json({ cancelled: true });
    }
    log.info('Folder dialog selected', { path: folderPath });
    res.json({ folderPath });
  } catch (err) {
    log.error('Folder dialog failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/folders', async (req, res) => {
  try {
    const folders = await MonitoredFolder.findAll({ order: [['id', 'DESC']] });
    const result = [];
    for (const folder of folders) {
      const fileCount = await IndexedFile.count({ where: { folderId: folder.id } });
      result.push({
        id: folder.id,
        path: folder.path,
        includeSubfolders: folder.includeSubfolders,
        active: folder.active,
        lastScanned: folder.lastScanned,
        fileCount
      });
    }
    res.json(result);
  } catch (err) {
    log.error('Failed to list folders', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const { folderPath, includeSubfolders } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });
    if (!fs.existsSync(folderPath)) return res.status(400).json({ error: 'Folder does not exist' });

    const existing = await MonitoredFolder.findOne({ where: { path: folderPath } });
    if (existing) return res.status(409).json({ error: 'Folder already monitored' });

    const folder = await MonitoredFolder.create({
      path: folderPath,
      includeSubfolders: includeSubfolders === true
    });

    log.info('Folder added', { path: folderPath });
    scannerBridge.send({ type: 'reload' });
    res.json({ id: folder.id, path: folder.path, includeSubfolders: folder.includeSubfolders, active: folder.active, fileCount: 0 });
  } catch (err) {
    log.error('Failed to add folder', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/folders/:id', async (req, res) => {
  try {
    const folder = await MonitoredFolder.findByPk(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const updates = {};
    if (req.body.includeSubfolders !== undefined) updates.includeSubfolders = req.body.includeSubfolders;
    if (req.body.active !== undefined) updates.active = req.body.active;
    if (Object.keys(updates).length > 0) await folder.update(updates);

    scannerBridge.send({ type: 'reload' });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to update folder', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/folders/:id', async (req, res) => {
  try {
    const folder = await MonitoredFolder.findByPk(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    await IndexedFile.destroy({ where: { folderId: folder.id } });
    await folder.destroy();

    log.info('Folder removed', { id: req.params.id, path: folder.path });
    scannerBridge.send({ type: 'reload' });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to remove folder', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders/scan', async (req, res) => {
  try {
    res.json({ success: true });
    scannerBridge.send({ type: 'scan-all' });
  } catch (err) {
    log.error('Manual scan failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tags', async (req, res) => {
  try {
    const tags = await Tag.findAll({ order: [['name', 'ASC']] });
    const result = [];
    for (const tag of tags) {
      const fileCount = await FileTag.count({ where: { tagId: tag.id } });
      result.push({ id: tag.id, name: tag.name, color: tag.color, fileCount });
    }
    res.json(result);
  } catch (err) {
    log.error('Failed to list tags', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

    const existing = await Tag.findOne({ where: { name: name.trim() } });
    if (existing) return res.status(409).json({ error: 'Tag already exists' });

    const tag = await Tag.create({ name: name.trim(), color: color || '#6c8cff' });
    log.info('Tag created', { name: tag.name });
    res.json({ id: tag.id, name: tag.name, color: tag.color, fileCount: 0 });
  } catch (err) {
    log.error('Failed to create tag', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tags/:id', async (req, res) => {
  try {
    const tag = await Tag.findByPk(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    if (req.body.name !== undefined) tag.name = req.body.name.trim();
    if (req.body.color !== undefined) tag.color = req.body.color;
    await tag.save();

    log.info('Tag updated', { id: tag.id, name: tag.name });
    res.json({ id: tag.id, name: tag.name, color: tag.color });
  } catch (err) {
    log.error('Failed to update tag', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    const tag = await Tag.findByPk(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    await FileTag.destroy({ where: { tagId: tag.id } });
    await tag.destroy();

    log.info('Tag deleted', { id: req.params.id, name: tag.name });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to delete tag', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tags/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    const fileTags = await FileTag.findAll({ where: { filePath } });
    const tags = [];
    for (const ft of fileTags) {
      const tag = await Tag.findByPk(ft.tagId);
      if (tag) tags.push({ id: tag.id, name: tag.name, color: tag.color });
    }
    res.json(tags);
  } catch (err) {
    log.error('Failed to get file tags', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags/file', async (req, res) => {
  try {
    const { filePath, tagId } = req.body;
    if (!filePath || !tagId) return res.status(400).json({ error: 'filePath and tagId are required' });

    const tag = await Tag.findByPk(tagId);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    const existing = await FileTag.findOne({ where: { filePath, tagId } });
    if (existing) return res.json({ id: existing.id, tagId, filePath });

    const fileTag = await FileTag.create({ filePath, tagId });
    log.info('Tag added to file', { filePath, tagId });
    res.json({ id: fileTag.id, tagId, filePath });
  } catch (err) {
    log.error('Failed to add tag to file', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/file', async (req, res) => {
  try {
    const { filePath, tagId } = req.body;
    if (!filePath || !tagId) return res.status(400).json({ error: 'filePath and tagId are required' });

    await FileTag.destroy({ where: { filePath, tagId } });
    log.info('Tag removed from file', { filePath, tagId });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to remove tag from file', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tags/all-file-tags', async (req, res) => {
  try {
    const fileTags = await FileTag.findAll();
    const tags = await Tag.findAll();
    const tagMap = {};
    tags.forEach(t => { tagMap[t.id] = t; });

    const result = fileTags.map(ft => ({
      filePath: ft.filePath,
      tagId: ft.tagId,
      tagName: tagMap[ft.tagId] ? tagMap[ft.tagId].name : '',
      tagColor: tagMap[ft.tagId] ? tagMap[ft.tagId].color : '#6c8cff'
    }));

    res.json(result);
  } catch (err) {
    log.error('Failed to get all file tags', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tags/:id/files', async (req, res) => {
  try {
    const fileTags = await FileTag.findAll({ where: { tagId: req.params.id } });
    const files = [];
    for (const ft of fileTags) {
      if (fs.existsSync(ft.filePath)) {
        files.push({ path: ft.filePath, name: path.basename(ft.filePath) });
      }
    }
    res.json(files);
  } catch (err) {
    log.error('Failed to get files for tag', { id: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags/set-file-tags', async (req, res) => {
  try {
    const { filePath, tags } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });

    const tagNames = [...new Set((tags || []).map(t => t.trim().toLowerCase()).filter(t => t.length > 0))];

    const tagRecords = [];
    for (const name of tagNames) {
      const [tag] = await Tag.findOrCreate({
        where: { name },
        defaults: { name, color: getTagColor(name) }
      });
      tagRecords.push(tag);
    }

    const tagIds = new Set(tagRecords.map(t => t.id));
    const existing = await FileTag.findAll({ where: { filePath } });
    for (const ft of existing) {
      if (!tagIds.has(ft.tagId)) await ft.destroy();
    }
    for (const tag of tagRecords) {
      await FileTag.findOrCreate({
        where: { filePath, tagId: tag.id },
        defaults: { filePath, tagId: tag.id }
      });
    }

    log.info('File tags set', { filePath, tags: tagNames });
    res.json({ success: true, tags: tagRecords.map(t => ({ id: t.id, name: t.name, color: t.color })) });
  } catch (err) {
    log.error('Failed to set file tags', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  log.error('Unhandled error', { method: req.method, path: req.path, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
