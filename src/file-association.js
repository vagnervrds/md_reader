const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const log = require('./logger');

function isWindows() {
  return process.platform === 'win32';
}

function getExecutablePath() {
  if (process.pkg) {
    return process.execPath;
  }

  const buildExe = path.resolve(__dirname, '..', 'build', 'mdreader.exe');
  if (fs.existsSync(buildExe)) {
    return buildExe;
  }

  const cwdExe = path.resolve(process.cwd(), 'build', 'mdreader.exe');
  if (fs.existsSync(cwdExe)) {
    return cwdExe;
  }

  return process.execPath;
}

function runPowerShell(script) {
  if (!isWindows()) {
    throw new Error('Associação de arquivos via Registro só é suportada no Windows');
  }

  return execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`
  ], { encoding: 'utf-8', windowsHide: true }).trim();
}

function checkStatus() {
  if (!isWindows()) {
    return {
      supported: false,
      message: 'Sistema operacional não suportado (apenas Windows)'
    };
  }

  const exePath = getExecutablePath();
  const script = `
    $progId = (Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md' -ErrorAction SilentlyContinue).'(default)'
    $cmd = (Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\mdreader.file\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)'
    $appCmd = (Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\Applications\\mdreader.exe\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)'
    [PSCustomObject]@{
      ProgId = $progId
      Command = $cmd
      AppCommand = $appCmd
    } | ConvertTo-Json -Compress
  `;

  try {
    const raw = runPowerShell(script);
    const parsed = raw ? JSON.parse(raw) : {};
    const isExe = exePath.toLowerCase().endsWith('.exe');
    const isAssociated = parsed.ProgId === 'mdreader.file';

    return {
      supported: true,
      isAssociated,
      exePath,
      isExe,
      currentProgId: parsed.ProgId || null,
      command: parsed.Command || null
    };
  } catch (err) {
    log.error('Erro ao verificar status da associação .md', { error: err.message });
    return {
      supported: true,
      isAssociated: false,
      exePath,
      error: err.message
    };
  }
}

function register() {
  if (!isWindows()) {
    throw new Error('Apenas Windows é suportado para registro de associação');
  }

  const exePath = getExecutablePath();
  const escapedExe = exePath.replace(/'/g, "''");

  const script = `
    $ErrorActionPreference = 'Stop'
    $exe = '${escapedExe}'
    $cmdVal = "\`"$exe\`" \`"%1\`""
    $iconVal = "\`"$exe\`",0"

    # Criar chave ProgID mdreader.file
    New-Item -Path 'HKCU:\\Software\\Classes\\mdreader.file' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\mdreader.file' -Name '(default)' -Value 'Arquivo Markdown (.md)'

    New-Item -Path 'HKCU:\\Software\\Classes\\mdreader.file\\DefaultIcon' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\mdreader.file\\DefaultIcon' -Name '(default)' -Value $iconVal

    New-Item -Path 'HKCU:\\Software\\Classes\\mdreader.file\\shell\\open\\command' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\mdreader.file\\shell\\open\\command' -Name '(default)' -Value $cmdVal

    # Associar extensao .md ao ProgID
    New-Item -Path 'HKCU:\\Software\\Classes\\.md' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md' -Name '(default)' -Value 'mdreader.file'
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md' -Name 'Content Type' -Value 'text/markdown'

    # Adicionar OpenWithProgids
    New-Item -Path 'HKCU:\\Software\\Classes\\.md\\OpenWithProgids' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md\\OpenWithProgids' -Name 'mdreader.file' -Value ''

    # Registrar em Applications
    New-Item -Path 'HKCU:\\Software\\Classes\\Applications\\mdreader.exe\\shell\\open\\command' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\Applications\\mdreader.exe\\shell\\open\\command' -Name '(default)' -Value $cmdVal

    # Notificar o Windows Shell da mudanca
    try {
      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      public class ShellNotify {
          [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
          public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
      }
"@
      [ShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
    } catch {}

    'OK'
  `;

  try {
    runPowerShell(script);
    log.info('Associação de arquivo .md registrada no Registro do Windows com sucesso', { exePath });
    return { success: true, exePath };
  } catch (err) {
    log.error('Falha ao registrar associação .md no Registro', { error: err.message });
    throw err;
  }
}

function unregister() {
  if (!isWindows()) {
    throw new Error('Apenas Windows é suportado para desregistrar associação');
  }

  const script = `
    $ErrorActionPreference = 'SilentlyContinue'

    # Remover ProgID mdreader.file
    Remove-Item -Path 'HKCU:\\Software\\Classes\\mdreader.file' -Recurse -Force -ErrorAction SilentlyContinue

    # Se a extensao .md ainda apontar para mdreader.file, limpar
    $current = (Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md' -ErrorAction SilentlyContinue).'(default)'
    if ($current -eq 'mdreader.file') {
      Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md' -Name '(default)' -Value '' -ErrorAction SilentlyContinue
    }

    Remove-ItemProperty -Path 'HKCU:\\Software\\Classes\\.md\\OpenWithProgids' -Name 'mdreader.file' -ErrorAction SilentlyContinue
    Remove-Item -Path 'HKCU:\\Software\\Classes\\Applications\\mdreader.exe' -Recurse -Force -ErrorAction SilentlyContinue

    # Notificar o Shell
    try {
      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      public class ShellNotify {
          [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
          public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
      }
"@
      [ShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
    } catch {}

    'OK'
  `;

  try {
    runPowerShell(script);
    log.info('Associação de arquivo .md removida do Registro do Windows com sucesso');
    return { success: true };
  } catch (err) {
    log.error('Falha ao desregistrar associação .md no Registro', { error: err.message });
    throw err;
  }
}

function openDefaultAppsSettings() {
  if (isWindows()) {
    spawn('cmd.exe', ['/c', 'start', 'ms-settings:defaultapps'], { detached: true, stdio: 'ignore' });
    return true;
  }
  return false;
}

module.exports = {
  isWindows,
  getExecutablePath,
  checkStatus,
  register,
  unregister,
  openDefaultAppsSettings
};
