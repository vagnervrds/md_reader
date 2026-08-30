package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"mdreader/internal/database"
)

const CommunityThemesURL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json"

type ThemeManager struct {
	db          *gorm.DB
	themesDir   string
	cacheLock   sync.Mutex
	cachedJSON  json.RawMessage
	cachedTime  time.Time
}

type InstalledTheme struct {
	Name        string    `json:"name"`
	File        string    `json:"file"`
	InstalledAt time.Time `json:"installedAt"`
}

type InstallThemeRequest struct {
	Repo   string `json:"repo"`
	Branch string `json:"branch"`
	Name   string `json:"name"`
}

func NewThemeManager(db *gorm.DB, appDir string) *ThemeManager {
	themesDir := filepath.Join(appDir, "themes")
	_ = os.MkdirAll(themesDir, 0755)
	return &ThemeManager{
		db:        db,
		themesDir: themesDir,
	}
}

func (tm *ThemeManager) GetCommunityThemes() (json.RawMessage, error) {
	tm.cacheLock.Lock()
	defer tm.cacheLock.Unlock()

	if tm.cachedJSON != nil && time.Since(tm.cachedTime) < 5*time.Minute {
		return tm.cachedJSON, nil
	}

	req, err := http.NewRequest("GET", CommunityThemesURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "mdreader")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bad status from github: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	tm.cachedJSON = body
	tm.cachedTime = time.Now()
	return body, nil
}

func (tm *ThemeManager) GetInstalledThemes() ([]InstalledTheme, error) {
	entries, err := os.ReadDir(tm.themesDir)
	if err != nil {
		return nil, err
	}

	var list []InstalledTheme
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".css") {
			name := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
			info, err := e.Info()
			modTime := time.Now()
			if err == nil {
				modTime = info.ModTime()
			}
			list = append(list, InstalledTheme{
				Name:        name,
				File:        e.Name(),
				InstalledAt: modTime,
			})
		}
	}
	return list, nil
}

func (tm *ThemeManager) fetchThemeCSS(repo, branch string) ([]byte, error) {
	branches := []string{"master", "main"}
	if branch != "" {
		branches = []string{branch}
	}
	files := []string{"obsidian.css", "theme.css"}

	client := &http.Client{Timeout: 10 * time.Second}

	for _, br := range branches {
		for _, file := range files {
			url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", repo, br, file)
			req, err := http.NewRequest("GET", url, nil)
			if err != nil {
				continue
			}
			req.Header.Set("User-Agent", "mdreader")

			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			if resp.StatusCode == http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err == nil && len(body) > 0 {
					return body, nil
				}
			} else {
				resp.Body.Close()
			}
		}
	}
	return nil, fmt.Errorf("theme CSS not found in repository")
}

func (tm *ThemeManager) InstallTheme(req InstallThemeRequest) error {
	if req.Repo == "" || req.Name == "" {
		return fmt.Errorf("repo and name are required")
	}

	cssContent, err := tm.fetchThemeCSS(req.Repo, req.Branch)
	if err != nil {
		return err
	}

	targetPath := filepath.Join(tm.themesDir, req.Name+".css")
	return os.WriteFile(targetPath, cssContent, 0644)
}

func (tm *ThemeManager) DeleteTheme(name string) error {
	targetPath := filepath.Join(tm.themesDir, name+".css")
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		return os.ErrNotExist
	}

	var active database.Setting
	if err := tm.db.First(&active, "key = ?", "active_theme").Error; err == nil {
		if active.Value == name {
			tm.db.Model(&database.Setting{}).Where("key = ?", "active_theme").Update("value", "")
		}
	}

	return os.Remove(targetPath)
}

func (tm *ThemeManager) GetThemeCSSPath(name string) string {
	return filepath.Join(tm.themesDir, name+".css")
}
