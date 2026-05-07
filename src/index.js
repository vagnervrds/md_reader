const fs = require('fs');
const path = require('path');
const sequelize = require('./database/index');
const Setting = require('./database/models/Setting');
const app = require('./server');

const PORT = 4181;

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

async function start() {
  await initDatabase();

  app.listen(PORT, async () => {
    console.log(`mdreader running at http://localhost:${PORT}`);
    const opn = require('opn');
    opn(`http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
