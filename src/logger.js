const fs = require('fs');
const path = require('path');

function getAppDir() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..');
}

const LOG_DIR = path.join(getAppDir(), 'log');
const LOG_FILE = path.join(LOG_DIR, 'log.log');
const MAX_SIZE = 1024 * 1024;
const MAX_FILES = 10;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString();
}

function formatMsg(level, msg, meta) {
  const ts = getTimestamp();
  let line = `[${ts}] [${level}] ${msg}`;
  if (meta !== undefined) {
    line += ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  return line;
}

function rotate() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_SIZE) return;

    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const oldFile = `${LOG_FILE}.${i}`;
      const newFile = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(oldFile)) {
        if (i === MAX_FILES - 1) {
          fs.unlinkSync(oldFile);
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (_) {}
}

function write(level, msg, meta) {
  const line = formatMsg(level, msg, meta);
  console.log(line);
  try {
    rotate();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

module.exports = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  debug: (msg, meta) => write('DEBUG', msg, meta)
};
