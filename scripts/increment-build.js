const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const buildJsonPath = path.join(projectRoot, 'build.json');
const winresJsonPath = path.join(projectRoot, 'winres', 'winres.json');

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

function updateWinres(buildNum, buildDate) {
  if (!fs.existsSync(winresJsonPath)) return;
  try {
    const wdata = JSON.parse(fs.readFileSync(winresJsonPath, 'utf8'));
    const verStr = `1.0.0.${buildNum}`;

    if (wdata.RT_MANIFEST && wdata.RT_MANIFEST['#1'] && wdata.RT_MANIFEST['#1']['0409']) {
      const manifest = wdata.RT_MANIFEST['#1']['0409'];
      if (manifest.identity) manifest.identity.version = verStr;
    }

    if (wdata.RT_VERSION && wdata.RT_VERSION['#1'] && wdata.RT_VERSION['#1']['0000']) {
      const verObj = wdata.RT_VERSION['#1']['0000'];
      if (verObj.fixed) {
        verObj.fixed.file_version = verStr;
        verObj.fixed.product_version = verStr;
      }
      if (verObj.info && verObj.info['0409']) {
        const info = verObj.info['0409'];
        info.FileVersion = verStr;
        info.ProductVersion = verStr;
        info.Comments = `Build #${buildNum} (${buildDate})`;
      }
    }

    fs.writeFileSync(winresJsonPath, JSON.stringify(wdata, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.warn('[Aviso] Nao foi possivel atualizar winres.json:', e.message);
  }
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
  updateWinres(data.build, data.date);

  console.log(`[Build] Versao incrementada para Build #${data.build} (${data.date})`);
  return data;
}

if (require.main === module) {
  incrementBuild();
}

module.exports = { incrementBuild };
