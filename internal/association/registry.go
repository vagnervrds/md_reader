package association

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type Status struct {
	Supported     bool   `json:"supported"`
	IsAssociated  bool   `json:"isAssociated"`
	ExePath       string `json:"exePath"`
	IsExe         bool   `json:"isExe"`
	CurrentProgID string `json:"currentProgId,omitempty"`
	Command       string `json:"command,omitempty"`
	Error         string `json:"error,omitempty"`
	Message       string `json:"message,omitempty"`
}

type RegisterResult struct {
	Success bool   `json:"success"`
	ExePath string `json:"exePath"`
}

type GenericResult struct {
	Success bool `json:"success"`
}

func GetExecutablePath() string {
	exePath, err := os.Executable()
	if err == nil {
		if strings.HasSuffix(strings.ToLower(exePath), ".exe") {
			return exePath
		}
	}
	cwd, err := os.Getwd()
	if err == nil {
		buildExe := filepath.Join(cwd, "build", "mdreader.exe")
		if _, err := os.Stat(buildExe); err == nil {
			return buildExe
		}
	}
	return exePath
}

func runPowerShell(script string) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("Associação de arquivos via Registro só é suportada no Windows")
	}

	cmd := exec.Command("powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command",
		"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "+script,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out.String()), nil
}

func CheckStatus() Status {
	if runtime.GOOS != "windows" {
		return Status{
			Supported: false,
			Message:   "Sistema operacional não suportado (apenas Windows)",
		}
	}

	exePath := GetExecutablePath()
	script := `
    $progId = (Get-ItemProperty -Path 'HKCU:\Software\Classes\.md' -ErrorAction SilentlyContinue).'(default)'
    $cmd = (Get-ItemProperty -Path 'HKCU:\Software\Classes\mdreader.file\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
    $appCmd = (Get-ItemProperty -Path 'HKCU:\Software\Classes\Applications\mdreader.exe\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
    [PSCustomObject]@{
      ProgId = $progId
      Command = $cmd
      AppCommand = $appCmd
    } | ConvertTo-Json -Compress
`

	raw, err := runPowerShell(script)
	if err != nil {
		return Status{
			Supported:    true,
			IsAssociated: false,
			ExePath:      exePath,
			Error:        err.Error(),
		}
	}

	var parsed struct {
		ProgID     string `json:"ProgId"`
		Command    string `json:"Command"`
		AppCommand string `json:"AppCommand"`
	}
	_ = json.Unmarshal([]byte(raw), &parsed)

	isExe := strings.HasSuffix(strings.ToLower(exePath), ".exe")
	isAssociated := parsed.ProgID == "mdreader.file"

	return Status{
		Supported:     true,
		IsAssociated:  isAssociated,
		ExePath:       exePath,
		IsExe:         isExe,
		CurrentProgID: parsed.ProgID,
		Command:       parsed.Command,
	}
}

func Register() (RegisterResult, error) {
	if runtime.GOOS != "windows" {
		return RegisterResult{}, errors.New("Apenas Windows é suportado para registro de associação")
	}

	exePath := GetExecutablePath()
	escapedExe := strings.ReplaceAll(exePath, "'", "''")

	script := fmt.Sprintf(`
    $ErrorActionPreference = 'Stop'
    $exe = '%s'
    $cmdVal = "`+"`\"$exe`\" `\"%%1`\""+`"
    $iconVal = "`+"`\"$exe`\",0"+`"

    # Criar chave ProgID mdreader.file
    New-Item -Path 'HKCU:\Software\Classes\mdreader.file' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\mdreader.file' -Name '(default)' -Value 'Arquivo Markdown (.md)'

    New-Item -Path 'HKCU:\Software\Classes\mdreader.file\DefaultIcon' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\mdreader.file\DefaultIcon' -Name '(default)' -Value $iconVal

    New-Item -Path 'HKCU:\Software\Classes\mdreader.file\shell\open\command' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\mdreader.file\shell\open\command' -Name '(default)' -Value $cmdVal

    # Associar extensao .md ao ProgID
    New-Item -Path 'HKCU:\Software\Classes\.md' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\.md' -Name '(default)' -Value 'mdreader.file'
    Set-ItemProperty -Path 'HKCU:\Software\Classes\.md' -Name 'Content Type' -Value 'text/markdown'

    # Adicionar OpenWithProgids
    New-Item -Path 'HKCU:\Software\Classes\.md\OpenWithProgids' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\.md\OpenWithProgids' -Name 'mdreader.file' -Value ''

    # Registrar em Applications
    New-Item -Path 'HKCU:\Software\Classes\Applications\mdreader.exe\shell\open\command' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\Applications\mdreader.exe\shell\open\command' -Name '(default)' -Value $cmdVal

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
`, escapedExe)

	_, err := runPowerShell(script)
	if err != nil {
		return RegisterResult{}, err
	}

	return RegisterResult{Success: true, ExePath: exePath}, nil
}

func Unregister() (GenericResult, error) {
	if runtime.GOOS != "windows" {
		return GenericResult{}, errors.New("Apenas Windows é suportado para desregistrar associação")
	}

	script := `
    $ErrorActionPreference = 'SilentlyContinue'

    # Remover ProgID mdreader.file
    Remove-Item -Path 'HKCU:\Software\Classes\mdreader.file' -Recurse -Force -ErrorAction SilentlyContinue

    # Se a extensao .md ainda apontar para mdreader.file, limpar
    $current = (Get-ItemProperty -Path 'HKCU:\Software\Classes\.md' -ErrorAction SilentlyContinue).'(default)'
    if ($current -eq 'mdreader.file') {
      Set-ItemProperty -Path 'HKCU:\Software\Classes\.md' -Name '(default)' -Value '' -ErrorAction SilentlyContinue
    }

    Remove-ItemProperty -Path 'HKCU:\Software\Classes\.md\OpenWithProgids' -Name 'mdreader.file' -ErrorAction SilentlyContinue
    Remove-Item -Path 'HKCU:\Software\Classes\Applications\mdreader.exe' -Recurse -Force -ErrorAction SilentlyContinue

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
`

	_, err := runPowerShell(script)
	if err != nil {
		return GenericResult{}, err
	}

	return GenericResult{Success: true}, nil
}

func OpenDefaultAppsSettings() bool {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd.exe", "/c", "start", "ms-settings:defaultapps")
		_ = cmd.Start()
		return true
	}
	return false
}
