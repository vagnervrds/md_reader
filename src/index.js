const fs = require('fs');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const sequelize = require('./database/index');
const Setting = require('./database/models/Setting');
require('./database/models/RecentFile');
require('./database/models/MonitoredFolder');
require('./database/models/IndexedFile');
require('./database/models/Tag');
require('./database/models/FileTag');
const app = require('./server');
const scannerBridge = require('./scanner-bridge');

const PORT = 4181;

function getTargetFileFromArgv() {
  const startIndex = process.pkg ? 1 : 2;
  for (let i = startIndex; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg || arg.startsWith('-')) continue;
    if (fs.existsSync(arg) || arg.toLowerCase().endsWith('.md') || arg.toLowerCase().endsWith('.markdown')) {
      return path.resolve(arg);
    }
  }
  return null;
}

function isServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/ping`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(600, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function initDatabase() {
  const appDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const dataDir = path.join(appDir, 'data');
  const themesDir = path.join(appDir, 'themes');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(themesDir)) fs.mkdirSync(themesDir, { recursive: true });

  await sequelize.sync();

  const theme = await Setting.findByPk('theme');
  if (!theme) {
    await Setting.create({ key: 'theme', value: 'dark' });
  }
}

function startScanner() {
  const proc = fork(path.join(__dirname, 'scanner-service.js'), [], { stdio: 'inherit' });
  scannerBridge.setProcess(proc);

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`Scanner exited (${code}), restarting in 5s...`);
      setTimeout(startScanner, 5000);
    }
  });
}

async function start() {
  const targetFile = getTargetFileFromArgv();
  const urlToOpen = targetFile
    ? `http://localhost:${PORT}/?file=${encodeURIComponent(targetFile)}`
    : `http://localhost:${PORT}`;

  const running = await isServerRunning(PORT);
  if (running) {
    const opn = require('opn');
    await opn(urlToOpen);
    process.exit(0);
    return;
  }

  await initDatabase();

  startScanner();

  app.listen(PORT, async () => {
    console.log(`mdreader running at http://localhost:${PORT}`);
    const opn = require('opn');
    opn(urlToOpen);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
