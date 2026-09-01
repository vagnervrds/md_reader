//go:build !windows

package server

import (
	"os"
	"time"
)

func getFileCreationTime(fi os.FileInfo) *time.Time {
	if fi == nil {
		return nil
	}
	t := fi.ModTime()
	return &t
}
