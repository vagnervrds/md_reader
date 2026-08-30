package scanner

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"gorm.io/gorm"

	"mdreader/internal/database"
)

type Scanner struct {
	db       *gorm.DB
	watcher  *fsnotify.Watcher
	mu       sync.Mutex
	timers   map[string]*time.Timer
	stopCh   chan struct{}
	actionCh chan string
}

func NewScanner(db *gorm.DB) (*Scanner, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	return &Scanner{
		db:       db,
		watcher:  watcher,
		timers:   make(map[string]*time.Timer),
		stopCh:   make(chan struct{}),
		actionCh: make(chan string, 10),
	}, nil
}

func (s *Scanner) Start() {
	go s.run()
	s.actionCh <- "reload"
}

func (s *Scanner) Stop() {
	close(s.stopCh)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.timers {
		t.Stop()
	}
	_ = s.watcher.Close()
}

func (s *Scanner) Reload() {
	s.actionCh <- "reload"
}

func (s *Scanner) ScanAll() {
	s.actionCh <- "scan-all"
}

func (s *Scanner) run() {
	for {
		select {
		case <-s.stopCh:
			return
		case act := <-s.actionCh:
			switch act {
			case "reload", "scan-all":
				s.reloadAndScan()
			}
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			ext := strings.ToLower(filepath.Ext(event.Name))
			if ext == ".md" || ext == ".markdown" || event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
				s.debounceScan()
			}
		case err, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[Scanner] Watcher error: %v", err)
		}
	}
}

func (s *Scanner) debounceScan() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if t, exists := s.timers["global"]; exists && t != nil {
		t.Stop()
	}
	s.timers["global"] = time.AfterFunc(2*time.Second, func() {
		s.actionCh <- "scan-all"
	})
}

func (s *Scanner) reloadAndScan() {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Clear existing watches
	for _, path := range s.watcher.WatchList() {
		_ = s.watcher.Remove(path)
	}

	var folders []database.MonitoredFolder
	if err := s.db.Where("active = ?", true).Find(&folders).Error; err != nil {
		log.Printf("[Scanner] Failed to fetch monitored folders: %v", err)
		return
	}

	for _, folder := range folders {
		s.syncFolder(folder)
		s.addWatchPaths(folder.Path, folder.IncludeSubfolders)
	}
	log.Printf("[Scanner] Synced and watching %d active folders", len(folders))
}

func (s *Scanner) addWatchPaths(root string, recursive bool) {
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return
	}

	_ = s.watcher.Add(root)
	if recursive {
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err == nil && d.IsDir() {
				_ = s.watcher.Add(path)
			}
			return nil
		})
	}
}

func (s *Scanner) scanFolderForMd(folderPath string, includeSubfolders bool) []string {
	var files []string
	if _, err := os.Stat(folderPath); os.IsNotExist(err) {
		return files
	}

	if !includeSubfolders {
		entries, err := os.ReadDir(folderPath)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					ext := strings.ToLower(filepath.Ext(entry.Name()))
					if ext == ".md" || ext == ".markdown" {
						files = append(files, filepath.Join(folderPath, entry.Name()))
					}
				}
			}
		}
		return files
	}

	_ = filepath.WalkDir(folderPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".md" || ext == ".markdown" {
				files = append(files, path)
			}
		}
		return nil
	})

	return files
}

func (s *Scanner) syncFolder(folder database.MonitoredFolder) {
	mdFiles := s.scanFolderForMd(folder.Path, folder.IncludeSubfolders)

	var existing []database.IndexedFile
	s.db.Where("folderId = ?", folder.ID).Find(&existing)

	existingMap := make(map[string]database.IndexedFile)
	for _, f := range existing {
		existingMap[f.Path] = f
	}

	currentSet := make(map[string]bool)
	added := 0
	removed := 0

	for _, filePath := range mdFiles {
		currentSet[filePath] = true
		if _, ok := existingMap[filePath]; !ok {
			name := filepath.Base(filePath)
			indexed := database.IndexedFile{
				Path:     filePath,
				Name:     name,
				FolderID: folder.ID,
			}
			s.db.Create(&indexed)

			var recent database.RecentFile
			if err := s.db.First(&recent, "path = ?", filePath).Error; err != nil {
				s.db.Create(&database.RecentFile{Path: filePath, Name: name})
			}
			added++
		}
	}

	for _, indexed := range existing {
		if !currentSet[indexed.Path] {
			s.db.Where("filePath = ?", indexed.Path).Delete(&database.FileTag{})
			s.db.Where("path = ?", indexed.Path).Delete(&database.RecentFile{})
			s.db.Delete(&indexed)
			removed++
		}
	}

	now := time.Now()
	s.db.Model(&folder).Update("lastScanned", &now)

	if added > 0 || removed > 0 {
		log.Printf("[Scanner] Folder synced: %s (added: %d, removed: %d)", folder.Path, added, removed)
	}
}
