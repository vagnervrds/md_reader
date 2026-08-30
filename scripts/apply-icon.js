const path = require('path');
const fs = require('fs');

async function applyIcon() {
  const exePath = path.resolve(__dirname, '..', 'build', 'mdreader.exe');
  const iconPath = path.resolve(__dirname, '..', 'assets', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.log(`[Icon] Executavel nao encontrado em: ${exePath}`);
    return;
  }

  if (!fs.existsSync(iconPath)) {
    console.log(`[Icon] Arquivo de icone nao encontrado em: ${iconPath}`);
    return;
  }

  console.log(`[Icon] Aplicando icone em ${exePath}...`);
  try {
    const ResEdit = await import('resedit');
    const exeBuffer = fs.readFileSync(exePath);
    const exe = ResEdit.NtExecutable.from(exeBuffer, { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);

    // Apply icon
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      iconFile.icons.map(item => item.data)
    );

    // Apply VersionInfo
    const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
    let vi = viList[0];
    if (!vi) {
      vi = ResEdit.Resource.VersionInfo.create({
        lang: 1033,
        codepage: 1200
      });
      vi.outputToResourceEntries(res.entries);
    }
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: 'mdreader',
        FileDescription: 'mdreader - Leitor de Markdown',
        CompanyName: 'mdreader',
        LegalCopyright: 'Copyright 2026',
        OriginalFilename: 'mdreader.exe',
        InternalName: 'mdreader'
      }
    );
    vi.outputToResourceEntries(res.entries);

    res.outputResource(exe);
    const newExeBuffer = Buffer.from(exe.generate());
    fs.writeFileSync(exePath, newExeBuffer);
    console.log('[Icon] Icone e metadados aplicados com sucesso ao executavel!');
  } catch (err) {
    console.error('[Icon] Erro ao aplicar icone:', err.message || err);
  }
}

if (require.main === module) {
  applyIcon();
}

module.exports = { applyIcon };
