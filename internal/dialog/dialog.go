package dialog

import (
	"bytes"
	"errors"
	"os/exec"
	"runtime"
	"strings"
)

var ErrUnsupported = errors.New("Dialog not supported on this platform")

func runPowerShell(script string) (string, error) {
	cmd := exec.Command("powershell.exe",
		"-NoProfile",
		"-STA",
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

func OpenFileDialog() (string, error) {
	if runtime.GOOS == "windows" {
		owner := `$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.WindowState = 'Minimized'; $owner.Show(); $owner.Activate();`
		script := `Add-Type -AssemblyName System.Windows.Forms; ` + owner + ` $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Markdown Files|*.md;*.markdown|All Files|*.*'; $d.Title = 'Abrir arquivo Markdown'; $result = $d.ShowDialog($owner); $owner.Close(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName } else { '' }`
		return runPowerShell(script)
	}

	if runtime.GOOS == "darwin" {
		cmd := exec.Command("osascript", "-e", `POSIX path of (choose file with prompt "Abrir arquivo Markdown" of type {"md", "markdown", "public.plain-text"})`)
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return "", nil // user cancelled
		}
		return strings.TrimSpace(out.String()), nil
	}

	return "", ErrUnsupported
}

func SaveFileDialog() (string, error) {
	if runtime.GOOS == "windows" {
		owner := `$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.WindowState = 'Minimized'; $owner.Show(); $owner.Activate();`
		script := `Add-Type -AssemblyName System.Windows.Forms; ` + owner + ` $d = New-Object System.Windows.Forms.SaveFileDialog; $d.Filter = 'Markdown Files|*.md;*.markdown|All Files|*.*'; $d.Title = 'Salvar como'; $d.FileName = 'novo_arquivo.md'; $result = $d.ShowDialog($owner); $owner.Close(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName } else { '' }`
		return runPowerShell(script)
	}

	if runtime.GOOS == "darwin" {
		cmd := exec.Command("osascript", "-e", `POSIX path of (choose file name with prompt "Salvar como" default name "novo_arquivo.md")`)
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return "", nil
		}
		return strings.TrimSpace(out.String()), nil
	}

	return "", ErrUnsupported
}

func FolderDialog() (string, error) {
	if runtime.GOOS == "windows" {
		owner := `$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.WindowState = 'Minimized'; $owner.Show(); $owner.Activate();`
		script := `Add-Type -AssemblyName System.Windows.Forms; ` + owner + `
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class ModernFolderDialog
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class NativeFileOpenDialog { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemArray { }

    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000100;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    public static string Show(string title, IntPtr owner)
    {
        var dialog = (IFileOpenDialog)new NativeFileOpenDialog();
        uint options = FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM;
        dialog.SetOptions(options);
        dialog.SetTitle(title);
        int hr = dialog.Show(owner);
        if (hr != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        IntPtr pszName;
        item.GetDisplayName(SIGDN_FILESYSPATH, out pszName);
        string path = Marshal.PtrToStringUni(pszName);
        Marshal.FreeCoTaskMem(pszName);
        return path;
    }
}
'@; $result = [ModernFolderDialog]::Show('Selecionar pasta para monitorar', $owner.Handle); $owner.Close(); if ($result) { $result } else { '' }`
		return runPowerShell(script)
	}

	if runtime.GOOS == "darwin" {
		cmd := exec.Command("osascript", "-e", `POSIX path of (choose folder with prompt "Selecionar pasta para monitorar")`)
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return "", nil
		}
		return strings.TrimSpace(out.String()), nil
	}

	return "", ErrUnsupported
}
