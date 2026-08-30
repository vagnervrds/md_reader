package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"mdreader/internal/database"
	"mdreader/internal/markdown"
	"mdreader/internal/server"
)

func setupTestDB(t *testing.T) (*gorm.DB, string) {
	tempDir, err := os.MkdirTemp("", "mdreader_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tempDir, "test.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	err = db.AutoMigrate(
		&database.RecentFile{},
		&database.Setting{},
		&database.MonitoredFolder{},
		&database.IndexedFile{},
		&database.Tag{},
		&database.FileTag{},
	)
	if err != nil {
		t.Fatalf("failed to automigrate: %v", err)
	}

	return db, tempDir
}

func TestMarkdownRender(t *testing.T) {
	md := `# Hello World
This is **bold** and *italic*.
- [x] Task done
- [ ] Task pending

| Col 1 | Col 2 |
|---|---|
| A | B |

` + "```go\npackage main\n\nfunc main() {}\n```"

	html, err := markdown.Render([]byte(md))
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}

	if !bytes.Contains([]byte(html), []byte("<h1")) {
		t.Errorf("expected <h1> tag in html, got: %s", html)
	}
	if !bytes.Contains([]byte(html), []byte("<table>")) {
		t.Errorf("expected <table> tag in html, got: %s", html)
	}
}

func TestPingEndpoint(t *testing.T) {
	db, tempDir := setupTestDB(t)
	defer os.RemoveAll(tempDir)

	srv := server.NewServer(db, nil, tempDir)

	req := httptest.NewRequest("GET", "/api/ping", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp map[string]bool
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil || !resp["ok"] {
		t.Errorf("expected ok: true, got %v", resp)
	}
}

func TestFileAndTagEndpoints(t *testing.T) {
	db, tempDir := setupTestDB(t)
	defer os.RemoveAll(tempDir)

	srv := server.NewServer(db, nil, tempDir)

	// 1. Create a markdown file
	testFile := filepath.Join(tempDir, "sample.md")
	content := "# My Sample Note\nContent here."
	if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// 2. Test GET /api/file?path=...
	req := httptest.NewRequest("GET", "/api/file?path="+testFile, nil)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var fileResp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&fileResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if fileResp["name"] != "sample.md" {
		t.Errorf("expected sample.md, got %v", fileResp["name"])
	}

	// 3. Test POST /api/tags
	tagPayload := map[string]string{"name": "Golang", "color": "#00add8"}
	bodyBytes, _ := json.Marshal(tagPayload)
	req = httptest.NewRequest("POST", "/api/tags", bytes.NewReader(bodyBytes))
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on create tag, got %d: %s", w.Code, w.Body.String())
	}

	// 4. Test GET /api/tags
	req = httptest.NewRequest("GET", "/api/tags", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on list tags, got %d", w.Code)
	}

	// 5. Test Settings
	settingPayload := map[string]string{"value": "light"}
	settingBytes, _ := json.Marshal(settingPayload)
	req = httptest.NewRequest("PUT", "/api/settings/theme", bytes.NewReader(settingBytes))
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on put setting, got %d", w.Code)
	}

	req = httptest.NewRequest("GET", "/api/settings/theme", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	var settingResp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&settingResp)
	if settingResp["value"] != "light" {
		t.Errorf("expected light, got %v", settingResp["value"])
	}
}
