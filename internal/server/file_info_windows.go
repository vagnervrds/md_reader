//go:build windows

package server

import (
	"os"
	"syscall"
	"time"
)

func getFileCreationTime(fi os.FileInfo) *time.Time {
	if fi == nil {
		return nil
	}
	if d, ok := fi.Sys().(*syscall.Win32FileAttributeData); ok {
		t := time.Unix(0, d.CreationTime.Nanoseconds())
		return &t
	}
	return nil
}
