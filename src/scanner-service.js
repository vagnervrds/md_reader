const fs = require('fs');
const path = require('path');
const sequelize = require('./database/index');
const MonitoredFolder = require('./database/models/MonitoredFolder');
const IndexedFile = require('./database/models/IndexedFile');
const RecentFile = require('./database/models/RecentFile');
const FileTag = require('./database/models/FileTag');
require('./database/models/Setting');
require('./database/models/Tag');
const log = require('./logger');

const watchers = new Map();
const DEBOUNCE_MS = 2000;

function scanFolderForMd(folderPath, includeSubfolders) {
  const files = [];
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && includeSubfolders) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.md' || ext === '.markdown') {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      log.warn('Error reading dir', { dir, error: err.message });
    }
  }
  walk(folderPath);
  return files;
}

async function syncFolder(folder) {
  try {
    const mdFiles = scanFolderForMd(folder.path, folder.includeSubfolders);
    const existing = await IndexedFile.findAll({ where: { folderId: folder.id } });
    const existingPaths = new Set(existing.map(f => f.path));

    let added = 0;
    let removed = 0;
    for (const filePath of mdFiles) {
      if (!existingPaths.has(filePath)) {
        const name = path.basename(filePath);
        await IndexedFile.create({ path: filePath, name, folderId: folder.id });
        const recentExists = await RecentFile.findOne({ where: { path: filePath } });
        if (!recentExists) await RecentFile.create({ path: filePath, name });
        added++;
      }
    }

    for (const indexed of existing) {
      if (!mdFiles.includes(indexed.path)) {
        await FileTag.destroy({ where: { filePath: indexed.path } });
        await RecentFile.destroy({ where: { path: indexed.path } });
        await indexed.destroy();
        removed++;
      }
    }

    await folder.update({ lastScanned: new Date() });
    if (added > 0 || removed > 0) log.info('Folder synced', { path: folder.path, added, removed });
  } catch (err) {
    log.error('Sync error', { path: folder.path, error: err.message });
  }
}

function debouncedSync(folder) {
  const entry = watchers.get(folder.path);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  entry.timeout = setTimeout(() => {
    entry.timeout = null;
    syncFolder(folder);
  }, DEBOUNCE_MS);
}

function setupWatch(folder) {
  if (watchers.has(folder.path)) return;
  try {
    const watcher = fs.watch(folder.path, { recursive: folder.includeSubfolders }, (eventType, filename) => {
      if (!filename) { debouncedSync(folder); return; }
      const ext = path.extname(filename).toLowerCase();
      if (ext === '.md' || ext === '.markdown' || eventType === 'rename') {
        debouncedSync(folder);
      }
    });
    watchers.set(folder.path, { watcher, timeout: null, folder });
    log.info('Watching', { path: folder.path, recursive: folder.includeSubfolders });
  } catch (err) {
    log.error('Watch failed', { path: folder.path, error: err.message });
  }
}

function clearAllWatches() {
  for (const [, entry] of watchers) {
    entry.watcher.close();
    if (entry.timeout) clearTimeout(entry.timeout);
  }
  watchers.clear();
}

async function reloadWatches() {
  clearAllWatches();
  const folders = await MonitoredFolder.findAll({ where: { active: true } });
  for (const folder of folders) setupWatch(folder);
  log.info('Watches reloaded', { count: folders.length });
}

async function initialScan() {
  const folders = await MonitoredFolder.findAll({ where: { active: true } });
  for (const folder of folders) {
    await syncFolder(folder);
    setupWatch(folder);
  }
  log.info('Scanner ready', { folders: folders.length });
}

process.on('message', async (msg) => {
  if (msg.type === 'reload') await reloadWatches();
  if (msg.type === 'scan-all') await reloadWatches();
  if (msg.type === 'stop') { clearAllWatches(); process.exit(0); }
});

process.on('SIGTERM', () => { clearAllWatches(); process.exit(0); });
process.on('SIGINT', () => { clearAllWatches(); process.exit(0); });

initialScan().catch(err => {
  log.error('Scanner init failed', { error: err.message });
  process.exit(1);
});
