package util

import (
	"os/exec"
	"runtime"
)

// OpenBrowser opens the specified URL in the user's default browser.
func OpenBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default: // linux, bsd, etc.
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

// OpenFileLocation opens the folder in the native file explorer (selecting the file if possible).
func OpenFileLocation(targetPath string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", "/select,"+targetPath)
	case "darwin":
		cmd = exec.Command("open", "-R", targetPath)
	default: // linux, bsd, etc.
		cmd = exec.Command("xdg-open", targetPath)
	}
	return cmd.Start()
}

