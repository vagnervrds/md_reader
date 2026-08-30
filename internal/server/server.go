package server

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"gorm.io/gorm"

	"mdreader/internal/association"
	"mdreader/internal/database"
	"mdreader/internal/dialog"
	"mdreader/internal/markdown"
	"mdreader/internal/scanner"
)

var tagColors = []string{
	"#6c8cff", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6",
	"#1abc9c", "#e67e22", "#3498db", "#e91e63", "#00bcd4",
}

func getTagColor(name string) string {
	var hash int32
	for i := 0; i < len(name); i++ {
		hash = int32(name[i]) + ((hash << 5) - hash)
	}
	abs := int(math.Abs(float64(hash)))
	return tagColors[abs%len(tagColors)]
}

func isSnapshotPath(p string) bool {
	if p == "" {
		return false
	}
	lower := strings.ToLower(p)
	return strings.Contains(lower, "snapshot") || strings.HasPrefix(lower, "\\snapshot") || strings.HasPrefix(lower, "/snapshot")
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, map[string]string{"error": msg})
}

type Server struct {
	router       *chi.Mux
	db           *gorm.DB
	scanner      *scanner.Scanner
	themeManager *ThemeManager
	appDir       string
}

func NewServer(db *gorm.DB, sc *scanner.Scanner, appDir string) *Server {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	s := &Server{
		router:       r,
		db:           db,
		scanner:      sc,
		themeManager: NewThemeManager(db, appDir),
		appDir:       appDir,
	}

	s.setupRoutes()
	return s
}

func (s *Server) Router() *chi.Mux {
	return s.router
}

func (s *Server) setupRoutes() {
	r := s.router

	r.Get("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// Themes API
	r.Get("/api/themes/community", s.handleGetCommunityThemes)
	r.Get("/api/themes/installed", s.handleGetInstalledThemes)
	r.Post("/api/themes/install", s.handleInstallTheme)
	r.Delete("/api/themes/{name}", s.handleDeleteTheme)
	r.Get("/api/themes/active", s.handleGetActiveTheme)
	r.Put("/api/themes/active", s.handleSetActiveTheme)
	r.Get("/themes/{name}.css", s.handleServeThemeCSS)

	// Files API
	r.Get("/api/file-raw", s.handleFileRaw)
	r.Get("/api/file", s.handleGetFile)
	r.Get("/api/file/{id}", s.handleGetFileByID)
	r.Put("/api/file", s.handleSaveFile)
	r.Post("/api/file-new", s.handleNewFile)
	r.Delete("/api/file-db", s.handleDeleteFileDB)

	// Dialogs API
	r.Get("/api/open-dialog", s.handleOpenDialog)
	r.Get("/api/save-dialog", s.handleSaveDialog)
	r.Get("/api/folder-dialog", s.handleFolderDialog)

	// Recent Files API
	r.Get("/api/recent-files", s.handleGetRecentFiles)
	r.Post("/api/recent-files", s.handlePostRecentFile)
	r.Delete("/api/recent-files/{id}", s.handleDeleteRecentFile)

	// Search API
	r.Get("/api/search", s.handleSearch)

	// Settings API
	r.Get("/api/settings/{key}", s.handleGetSetting)
	r.Put("/api/settings/{key}", s.handlePutSetting)

	// Monitored Folders API
	r.Get("/api/folders", s.handleGetFolders)
	r.Post("/api/folders", s.handlePostFolder)
	r.Put("/api/folders/{id}", s.handlePutFolder)
	r.Delete("/api/folders/{id}", s.handleDeleteFolder)
	r.Post("/api/folders/scan", s.handleScanFolders)

	// Tags API
	r.Get("/api/tags", s.handleGetTags)
	r.Post("/api/tags", s.handlePostTag)
	r.Put("/api/tags/{id}", s.handlePutTag)
	r.Delete("/api/tags/{id}", s.handleDeleteTag)
	r.Get("/api/tags/file", s.handleGetFileTags)
	r.Post("/api/tags/file", s.handlePostFileTag)
	r.Delete("/api/tags/file", s.handleDeleteFileTag)
	r.Get("/api/tags/all-file-tags", s.handleGetAllFileTags)
	r.Get("/api/tags/{id}/files", s.handleGetTagFiles)
	r.Post("/api/tags/set-file-tags", s.handleSetFileTags)

	// File Association API
	r.Get("/api/association/status", s.handleAssociationStatus)
	r.Post("/api/association/register", s.handleAssociationRegister)
	r.Post("/api/association/unregister", s.handleAssociationUnregister)
	r.Post("/api/association/open-settings", s.handleAssociationOpenSettings)

	// Static Web Frontend (fallback for SPA routes like /file/1)
	r.Mount("/", StaticFileServer())
}

// ---------------- Themes Handlers ----------------

func (s *Server) handleGetCommunityThemes(w http.ResponseWriter, r *http.Request) {
	data, err := s.themeManager.GetCommunityThemes()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func (s *Server) handleGetInstalledThemes(w http.ResponseWriter, r *http.Request) {
	themes, err := s.themeManager.GetInstalledThemes()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, themes)
}

func (s *Server) handleInstallTheme(w http.ResponseWriter, r *http.Request) {
	var req InstallThemeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}
	if err := s.themeManager.InstallTheme(req); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"name":    req.Name,
		"file":    req.Name + ".css",
	})
}

func (s *Server) handleDeleteTheme(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := s.themeManager.DeleteTheme(name); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			jsonError(w, http.StatusNotFound, "Theme not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleGetActiveTheme(w http.ResponseWriter, r *http.Request) {
	var setting database.Setting
	if err := s.db.First(&setting, "key = ?", "active_theme").Error; err != nil {
		jsonResponse(w, http.StatusOK, map[string]any{"name": nil})
		return
	}
	var name any = setting.Value
	if setting.Value == "" {
		name = nil
	}
	jsonResponse(w, http.StatusOK, map[string]any{"name": name})
}

func (s *Server) handleSetActiveTheme(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.Name != "" {
		cssPath := s.themeManager.GetThemeCSSPath(body.Name)
		if _, err := os.Stat(cssPath); os.IsNotExist(err) {
			jsonError(w, http.StatusNotFound, "Theme not installed")
			return
		}
	}

	setting := database.Setting{Key: "active_theme", Value: body.Name}
	s.db.Save(&setting)

	var name any = body.Name
	if body.Name == "" {
		name = nil
	}
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "name": name})
}

func (s *Server) handleServeThemeCSS(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	cssPath := s.themeManager.GetThemeCSSPath(name)
	if _, err := os.Stat(cssPath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/css")
	http.ServeFile(w, r, cssPath)
}

// ---------------- Files Handlers ----------------

func (s *Server) handleFileRaw(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, http.StatusBadRequest, "Caminho do arquivo não fornecido")
		return
	}
	if isSnapshotPath(filePath) {
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"path":     filePath,
		})
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"path":     filePath,
		})
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"content": string(data)})
}

func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, http.StatusBadRequest, "Caminho do arquivo não fornecido")
		return
	}

	name := filepath.Base(filePath)
	if isSnapshotPath(filePath) {
		var recent database.RecentFile
		if err := s.db.First(&recent, "path = ?", filePath).Error; err == nil {
			s.db.Delete(&recent)
		}
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"path":     filePath,
			"name":     name,
		})
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		var recent database.RecentFile
		var id any = nil
		if errDb := s.db.First(&recent, "path = ?", filePath).Error; errDb == nil {
			id = recent.ID
		}
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"path":     filePath,
			"name":     name,
			"id":       id,
		})
		return
	}

	html, err := markdown.Render(data)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var recent database.RecentFile
	if err := s.db.First(&recent, "path = ?", filePath).Error; err == nil {
		recent.LastOpened = time.Now()
		s.db.Save(&recent)
	} else {
		recent = database.RecentFile{
			Path:       filePath,
			Name:       name,
			LastOpened: time.Now(),
		}
		s.db.Create(&recent)
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"id":   recent.ID,
		"name": recent.Name,
		"path": recent.Path,
		"html": html,
	})
}

func (s *Server) handleGetFileByID(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid file ID")
		return
	}

	var recent database.RecentFile
	if err := s.db.First(&recent, id).Error; err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no banco de dados",
			"notFound": true,
			"id":       id,
		})
		return
	}

	if isSnapshotPath(recent.Path) {
		s.db.Delete(&recent)
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"id":       recent.ID,
			"name":     recent.Name,
			"path":     recent.Path,
		})
		return
	}

	data, err := os.ReadFile(recent.Path)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]any{
			"error":    "Arquivo não encontrado no disco",
			"notFound": true,
			"id":       recent.ID,
			"name":     recent.Name,
			"path":     recent.Path,
		})
		return
	}

	html, err := markdown.Render(data)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	recent.LastOpened = time.Now()
	s.db.Save(&recent)

	jsonResponse(w, http.StatusOK, map[string]any{
		"id":   recent.ID,
		"name": recent.Name,
		"path": recent.Path,
		"html": html,
	})
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid payload")
		return
	}
	if body.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := os.WriteFile(body.Path, []byte(body.Content), 0644); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	name := filepath.Base(body.Path)
	html, _ := markdown.Render([]byte(body.Content))

	var recent database.RecentFile
	if err := s.db.First(&recent, "path = ?", body.Path).Error; err == nil {
		recent.LastOpened = time.Now()
		s.db.Save(&recent)
	} else {
		recent = database.RecentFile{Path: body.Path, Name: name, LastOpened: time.Now()}
		s.db.Create(&recent)
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"name":    name,
		"html":    html,
	})
}

func (s *Server) handleNewFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	dir := filepath.Dir(body.Path)
	_ = os.MkdirAll(dir, 0755)

	if _, err := os.Stat(body.Path); err == nil {
		jsonError(w, http.StatusConflict, "File already exists")
		return
	}

	if err := os.WriteFile(body.Path, []byte(""), 0644); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	name := filepath.Base(body.Path)
	recent := database.RecentFile{Path: body.Path, Name: name, LastOpened: time.Now()}
	s.db.Create(&recent)

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"name":    name,
		"path":    body.Path,
	})
}

func (s *Server) handleDeleteFileDB(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	idStr := r.URL.Query().Get("id")

	var body struct {
		Path string `json:"path"`
		ID   uint   `json:"id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if targetPath == "" {
		targetPath = body.Path
	}

	var targetID uint
	if idStr != "" {
		parsed, _ := strconv.ParseUint(idStr, 10, 32)
		targetID = uint(parsed)
	} else if body.ID != 0 {
		targetID = body.ID
	}

	if targetID != 0 {
		var recent database.RecentFile
		if err := s.db.First(&recent, targetID).Error; err == nil {
			if targetPath == "" {
				targetPath = recent.Path
			}
			s.db.Delete(&recent)
		}
		var indexed database.IndexedFile
		if err := s.db.First(&indexed, targetID).Error; err == nil {
			if targetPath == "" {
				targetPath = indexed.Path
			}
			s.db.Delete(&indexed)
		}
	}

	if targetPath != "" {
		s.db.Where("path = ?", targetPath).Delete(&database.RecentFile{})
		s.db.Where("path = ?", targetPath).Delete(&database.IndexedFile{})
		s.db.Where("filePath = ?", targetPath).Delete(&database.FileTag{})
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

// ---------------- Dialog Handlers ----------------

func (s *Server) handleOpenDialog(w http.ResponseWriter, r *http.Request) {
	filePath, err := dialog.OpenFileDialog()
	if err != nil {
		if errors.Is(err, dialog.ErrUnsupported) {
			jsonError(w, http.StatusNotImplemented, err.Error())
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if filePath == "" {
		jsonResponse(w, http.StatusOK, map[string]bool{"cancelled": true})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"filePath": filePath})
}

func (s *Server) handleSaveDialog(w http.ResponseWriter, r *http.Request) {
	filePath, err := dialog.SaveFileDialog()
	if err != nil {
		if errors.Is(err, dialog.ErrUnsupported) {
			jsonError(w, http.StatusNotImplemented, err.Error())
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if filePath == "" {
		jsonResponse(w, http.StatusOK, map[string]bool{"cancelled": true})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"filePath": filePath})
}

func (s *Server) handleFolderDialog(w http.ResponseWriter, r *http.Request) {
	folderPath, err := dialog.FolderDialog()
	if err != nil {
		if errors.Is(err, dialog.ErrUnsupported) {
			jsonError(w, http.StatusNotImplemented, err.Error())
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if folderPath == "" {
		jsonResponse(w, http.StatusOK, map[string]bool{"cancelled": true})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"folderPath": folderPath})
}

// ---------------- Recent Files Handlers ----------------

func (s *Server) handleGetRecentFiles(w http.ResponseWriter, r *http.Request) {
	var files []database.RecentFile
	s.db.Order("last_opened DESC").Limit(50).Find(&files)

	var valid []database.RecentFile
	for _, f := range files {
		if !isSnapshotPath(f.Path) && !strings.HasSuffix(strings.ToLower(f.Path), ".js") {
			valid = append(valid, f)
		}
	}
	if valid == nil {
		valid = []database.RecentFile{}
	}
	jsonResponse(w, http.StatusOK, valid)
}

func (s *Server) handlePostRecentFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath string `json:"filePath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FilePath == "" {
		jsonError(w, http.StatusBadRequest, "filePath is required")
		return
	}
	if isSnapshotPath(body.FilePath) {
		jsonError(w, http.StatusBadRequest, "Invalid path")
		return
	}

	name := filepath.Base(body.FilePath)
	var recent database.RecentFile
	if err := s.db.First(&recent, "path = ?", body.FilePath).Error; err == nil {
		recent.LastOpened = time.Now()
		s.db.Save(&recent)
		jsonResponse(w, http.StatusOK, recent)
	} else {
		recent = database.RecentFile{Path: body.FilePath, Name: name, LastOpened: time.Now()}
		s.db.Create(&recent)
		jsonResponse(w, http.StatusOK, recent)
	}
}

func (s *Server) handleDeleteRecentFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var recent database.RecentFile
	if err := s.db.First(&recent, id).Error; err == nil {
		s.db.Where("path = ?", recent.Path).Delete(&database.IndexedFile{})
		s.db.Where("filePath = ?", recent.Path).Delete(&database.FileTag{})
		s.db.Delete(&recent)
	}
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

// ---------------- Search Handler ----------------

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(r.URL.Query().Get("q"))
	if q == "" {
		jsonResponse(w, http.StatusOK, []any{})
		return
	}

	var files []database.RecentFile
	s.db.Order("last_opened DESC").Find(&files)

	type searchResult struct {
		ID         uint      `json:"id"`
		Name       string    `json:"name"`
		Path       string    `json:"path"`
		LastOpened time.Time `json:"last_opened"`
		MatchType  string    `json:"matchType"`
	}

	var results []searchResult
	for _, file := range files {
		if isSnapshotPath(file.Path) {
			continue
		}

		nameMatch := strings.Contains(strings.ToLower(file.Name), q)
		contentMatch := false

		if data, err := os.ReadFile(file.Path); err == nil {
			contentMatch = strings.Contains(strings.ToLower(string(data)), q)
		}

		if nameMatch || contentMatch {
			matchType := "content"
			if nameMatch && contentMatch {
				matchType = "both"
			} else if nameMatch {
				matchType = "name"
			}

			results = append(results, searchResult{
				ID:         file.ID,
				Name:       file.Name,
				Path:       file.Path,
				LastOpened: file.LastOpened,
				MatchType:  matchType,
			})
		}
	}

	if results == nil {
		results = []searchResult{}
	}
	jsonResponse(w, http.StatusOK, results)
}

// ---------------- Settings Handlers ----------------

func (s *Server) handleGetSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	var setting database.Setting
	if err := s.db.First(&setting, "key = ?", key).Error; err != nil {
		jsonResponse(w, http.StatusOK, map[string]any{"key": key, "value": nil})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"key": key, "value": setting.Value})
}

func (s *Server) handlePutSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	var body struct {
		Value string `json:"value"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	setting := database.Setting{Key: key, Value: body.Value}
	s.db.Save(&setting)
	jsonResponse(w, http.StatusOK, map[string]any{"key": key, "value": body.Value})
}

// ---------------- Folders Handlers ----------------

func (s *Server) handleGetFolders(w http.ResponseWriter, r *http.Request) {
	var folders []database.MonitoredFolder
	s.db.Order("id DESC").Find(&folders)

	type folderDTO struct {
		ID                uint       `json:"id"`
		Path              string     `json:"path"`
		IncludeSubfolders bool       `json:"includeSubfolders"`
		Active            bool       `json:"active"`
		LastScanned       *time.Time `json:"lastScanned"`
		FileCount         int64      `json:"fileCount"`
	}

	var results []folderDTO
	for _, f := range folders {
		var count int64
		s.db.Model(&database.IndexedFile{}).Where("folderId = ?", f.ID).Count(&count)
		results = append(results, folderDTO{
			ID:                f.ID,
			Path:              f.Path,
			IncludeSubfolders: f.IncludeSubfolders,
			Active:            f.Active,
			LastScanned:       f.LastScanned,
			FileCount:         count,
		})
	}
	if results == nil {
		results = []folderDTO{}
	}
	jsonResponse(w, http.StatusOK, results)
}

func (s *Server) handlePostFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FolderPath        string `json:"folderPath"`
		IncludeSubfolders bool   `json:"includeSubfolders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FolderPath == "" {
		jsonError(w, http.StatusBadRequest, "folderPath is required")
		return
	}

	if _, err := os.Stat(body.FolderPath); os.IsNotExist(err) {
		jsonError(w, http.StatusBadRequest, "Folder does not exist")
		return
	}

	var existing database.MonitoredFolder
	if err := s.db.First(&existing, "path = ?", body.FolderPath).Error; err == nil {
		jsonError(w, http.StatusConflict, "Folder already monitored")
		return
	}

	folder := database.MonitoredFolder{
		Path:              body.FolderPath,
		IncludeSubfolders: body.IncludeSubfolders,
		Active:            true,
	}
	s.db.Create(&folder)

	if s.scanner != nil {
		s.scanner.Reload()
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"id":                folder.ID,
		"path":              folder.Path,
		"includeSubfolders": folder.IncludeSubfolders,
		"active":            folder.Active,
		"fileCount":         0,
	})
}

func (s *Server) handlePutFolder(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var folder database.MonitoredFolder
	if err := s.db.First(&folder, id).Error; err != nil {
		jsonError(w, http.StatusNotFound, "Folder not found")
		return
	}

	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)

	if v, ok := body["includeSubfolders"].(bool); ok {
		folder.IncludeSubfolders = v
	}
	if v, ok := body["active"].(bool); ok {
		folder.Active = v
	}
	s.db.Save(&folder)

	if s.scanner != nil {
		s.scanner.Reload()
	}
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var folder database.MonitoredFolder
	if err := s.db.First(&folder, id).Error; err != nil {
		jsonError(w, http.StatusNotFound, "Folder not found")
		return
	}

	s.db.Where("folderId = ?", folder.ID).Delete(&database.IndexedFile{})
	s.db.Delete(&folder)

	if s.scanner != nil {
		s.scanner.Reload()
	}
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleScanFolders(w http.ResponseWriter, r *http.Request) {
	if s.scanner != nil {
		s.scanner.ScanAll()
	}
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

// ---------------- Tags Handlers ----------------

func (s *Server) handleGetTags(w http.ResponseWriter, r *http.Request) {
	var tags []database.Tag
	s.db.Order("name ASC").Find(&tags)

	type tagDTO struct {
		ID        uint   `json:"id"`
		Name      string `json:"name"`
		Color     string `json:"color"`
		FileCount int64  `json:"fileCount"`
	}

	var results []tagDTO
	for _, t := range tags {
		var count int64
		s.db.Model(&database.FileTag{}).Where("tagId = ?", t.ID).Count(&count)
		results = append(results, tagDTO{
			ID:        t.ID,
			Name:      t.Name,
			Color:     t.Color,
			FileCount: count,
		})
	}
	if results == nil {
		results = []tagDTO{}
	}
	jsonResponse(w, http.StatusOK, results)
}

func (s *Server) handlePostTag(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		jsonError(w, http.StatusBadRequest, "name is required")
		return
	}

	name := strings.TrimSpace(body.Name)
	var existing database.Tag
	if err := s.db.First(&existing, "name = ?", name).Error; err == nil {
		jsonError(w, http.StatusConflict, "Tag already exists")
		return
	}

	color := body.Color
	if color == "" {
		color = getTagColor(name)
	}

	tag := database.Tag{Name: name, Color: color}
	s.db.Create(&tag)

	jsonResponse(w, http.StatusOK, map[string]any{
		"id":        tag.ID,
		"name":      tag.Name,
		"color":     tag.Color,
		"fileCount": 0,
	})
}

func (s *Server) handlePutTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var tag database.Tag
	if err := s.db.First(&tag, id).Error; err != nil {
		jsonError(w, http.StatusNotFound, "Tag not found")
		return
	}

	var body struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		tag.Name = strings.TrimSpace(*body.Name)
	}
	if body.Color != nil {
		tag.Color = *body.Color
	}
	s.db.Save(&tag)

	jsonResponse(w, http.StatusOK, tag)
}

func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var tag database.Tag
	if err := s.db.First(&tag, id).Error; err != nil {
		jsonError(w, http.StatusNotFound, "Tag not found")
		return
	}

	s.db.Where("tagId = ?", tag.ID).Delete(&database.FileTag{})
	s.db.Delete(&tag)

	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleGetFileTags(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}

	var fileTags []database.FileTag
	s.db.Where("filePath = ?", filePath).Find(&fileTags)

	var tags []database.Tag
	for _, ft := range fileTags {
		var tag database.Tag
		if err := s.db.First(&tag, ft.TagID).Error; err == nil {
			tags = append(tags, tag)
		}
	}
	if tags == nil {
		tags = []database.Tag{}
	}
	jsonResponse(w, http.StatusOK, tags)
}

func (s *Server) handlePostFileTag(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath string `json:"filePath"`
		TagID    uint   `json:"tagId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FilePath == "" || body.TagID == 0 {
		jsonError(w, http.StatusBadRequest, "filePath and tagId are required")
		return
	}

	var tag database.Tag
	if err := s.db.First(&tag, body.TagID).Error; err != nil {
		jsonError(w, http.StatusNotFound, "Tag not found")
		return
	}

	var fileTag database.FileTag
	if err := s.db.First(&fileTag, "filePath = ? AND tagId = ?", body.FilePath, body.TagID).Error; err == nil {
		jsonResponse(w, http.StatusOK, fileTag)
		return
	}

	fileTag = database.FileTag{FilePath: body.FilePath, TagID: body.TagID}
	s.db.Create(&fileTag)
	jsonResponse(w, http.StatusOK, fileTag)
}

func (s *Server) handleDeleteFileTag(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath string `json:"filePath"`
		TagID    uint   `json:"tagId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.FilePath == "" || body.TagID == 0 {
		jsonError(w, http.StatusBadRequest, "filePath and tagId are required")
		return
	}

	s.db.Where("filePath = ? AND tagId = ?", body.FilePath, body.TagID).Delete(&database.FileTag{})
	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleGetAllFileTags(w http.ResponseWriter, r *http.Request) {
	var fileTags []database.FileTag
	s.db.Find(&fileTags)

	var tags []database.Tag
	s.db.Find(&tags)

	tagMap := make(map[uint]database.Tag)
	for _, t := range tags {
		tagMap[t.ID] = t
	}

	type fileTagDTO struct {
		FilePath string `json:"filePath"`
		TagID    uint   `json:"tagId"`
		TagName  string `json:"tagName"`
		TagColor string `json:"tagColor"`
	}

	var results []fileTagDTO
	for _, ft := range fileTags {
		t := tagMap[ft.TagID]
		color := t.Color
		if color == "" {
			color = "#6c8cff"
		}
		results = append(results, fileTagDTO{
			FilePath: ft.FilePath,
			TagID:    ft.TagID,
			TagName:  t.Name,
			TagColor: color,
		})
	}
	if results == nil {
		results = []fileTagDTO{}
	}
	jsonResponse(w, http.StatusOK, results)
}

func (s *Server) handleGetTagFiles(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var fileTags []database.FileTag
	s.db.Where("tagId = ?", id).Find(&fileTags)

	type fileDTO struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}

	var results []fileDTO
	for _, ft := range fileTags {
		if _, err := os.Stat(ft.FilePath); err == nil {
			results = append(results, fileDTO{
				Path: ft.FilePath,
				Name: filepath.Base(ft.FilePath),
			})
		}
	}
	if results == nil {
		results = []fileDTO{}
	}
	jsonResponse(w, http.StatusOK, results)
}

func (s *Server) handleSetFileTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath string   `json:"filePath"`
		Tags     []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FilePath == "" {
		jsonError(w, http.StatusBadRequest, "filePath is required")
		return
	}

	// Deduplicate and trim tag names
	tagSet := make(map[string]bool)
	var cleanNames []string
	for _, t := range body.Tags {
		name := strings.ToLower(strings.TrimSpace(t))
		if name != "" && !tagSet[name] {
			tagSet[name] = true
			cleanNames = append(cleanNames, name)
		}
	}

	var tagRecords []database.Tag
	for _, name := range cleanNames {
		var tag database.Tag
		if err := s.db.First(&tag, "name = ?", name).Error; err != nil {
			tag = database.Tag{Name: name, Color: getTagColor(name)}
			s.db.Create(&tag)
		}
		tagRecords = append(tagRecords, tag)
	}

	targetTagIDs := make(map[uint]bool)
	for _, t := range tagRecords {
		targetTagIDs[t.ID] = true
	}

	var existingFileTags []database.FileTag
	s.db.Where("filePath = ?", body.FilePath).Find(&existingFileTags)

	for _, ft := range existingFileTags {
		if !targetTagIDs[ft.TagID] {
			s.db.Delete(&ft)
		}
	}

	for _, t := range tagRecords {
		var ft database.FileTag
		if err := s.db.First(&ft, "filePath = ? AND tagId = ?", body.FilePath, t.ID).Error; err != nil {
			s.db.Create(&database.FileTag{FilePath: body.FilePath, TagID: t.ID})
		}
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"tags":    tagRecords,
	})
}

// ---------------- Association Handlers ----------------

func (s *Server) handleAssociationStatus(w http.ResponseWriter, r *http.Request) {
	status := association.CheckStatus()
	jsonResponse(w, http.StatusOK, status)
}

func (s *Server) handleAssociationRegister(w http.ResponseWriter, r *http.Request) {
	res, err := association.Register()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleAssociationUnregister(w http.ResponseWriter, r *http.Request) {
	res, err := association.Unregister()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, res)
}

func (s *Server) handleAssociationOpenSettings(w http.ResponseWriter, r *http.Request) {
	ok := association.OpenDefaultAppsSettings()
	jsonResponse(w, http.StatusOK, map[string]bool{"success": ok})
}
