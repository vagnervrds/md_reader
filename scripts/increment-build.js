const fs = require('fs');
const path = require('path');

const buildJsonPath = path.join(__dirname, '..', 'build.json');

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function incrementBuild() {
  let data = { build: 0, date: '' };
  if (fs.existsSync(buildJsonPath)) {
    try {
      data = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
    } catch (e) {
      data = { build: 0, date: '' };
    }
  }

  data.build = (parseInt(data.build, 10) || 0) + 1;
  data.date = formatDate(new Date());

  fs.writeFileSync(buildJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`[Build] Versao incrementada para Build #${data.build} (${data.date})`);
  return data;
}

if (require.main === module) {
  incrementBuild();
}

module.exports = { incrementBuild };
