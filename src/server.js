const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const hljs = require('highlight.js');
const RecentFile = require('./database/models/RecentFile');
const Setting = require('./database/models/Setting');

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

const THEMES_DIR = path.join(__dirname, '..', 'themes');
const COMMUNITY_THEMES_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json';

if (!fs.existsSync(THEMES_DIR)) {
  fs.mkdirSync(THEMES_DIR, { recursive: true });
}

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
    res.json(themes);
  } catch (err) {
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
      installed.push({
        name: themeName,
        file: file,
        installedAt: stat.mtime
      });
    }

    res.json(installed);
  } catch (err) {
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

    const themePath = path.join(THEMES_DIR, `${name}.css`);
    const cssContent = await fetchThemeCss(repo, branch || null);

    if (!cssContent) {
      return res.status(404).json({ error: 'Theme CSS not found in repository' });
    }

    fs.writeFileSync(themePath, cssContent, 'utf-8');
    res.json({ success: true, name, file: `${name}.css` });
  } catch (err) {
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/themes/active', async (req, res) => {
  try {
    const setting = await Setting.findByPk('active_theme');
    res.json({ name: setting ? setting.value : null });
  } catch (err) {
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
    res.json({ success: true, name: name || null });
  } catch (err) {
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
    res.json({ content });
  } catch (err) {
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

    res.json({ success: true, name, html });
  } catch (err) {
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

    res.json({ success: true, name, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/save-dialog', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    if (process.platform !== 'win32') return res.status(501).json({ error: 'Not supported' });

    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Markdown Files|*.md;*.markdown|All Files|*.*'; $d.Title = 'Salvar como'; $d.FileName = 'novo_arquivo.md'; if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { '' }`;
    const filePath = execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();

    if (!filePath) return res.json({ cancelled: true });
    res.json({ filePath });
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recent-files/:id', async (req, res) => {
  try {
    await RecentFile.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const content = fs.readFileSync(filePath, 'utf-8');
    const html = marked.parse(content);

    const name = path.basename(filePath);
    const existing = await RecentFile.findOne({ where: { path: filePath } });
    if (existing) {
      await existing.update({ last_opened: new Date() });
    } else {
      await RecentFile.create({ path: filePath, name });
    }

    res.json({ name, path: filePath, html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        } catch (_) {}
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

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const setting = await Setting.findByPk(req.params.key);
    res.json({ key: req.params.key, value: setting ? setting.value : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await Setting.upsert({ key: req.params.key, value });
    res.json({ key: req.params.key, value });
  } catch (err) {
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
      filePath = execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();
    } else {
      return res.status(501).json({ error: 'Dialog not supported on this platform' });
    }

    if (!filePath) return res.json({ cancelled: true });
    res.json({ filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
