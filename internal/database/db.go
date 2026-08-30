package database

import (
	"log"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func GetAppDir() string {
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		// If running with go run in temp directory, fallback to current working dir
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil || filepath.Base(dir) != "exe" {
			// Check if we are inside a build output directory or project root
			return dir
		}
	}
	cwd, err := os.Getwd()
	if err == nil {
		return cwd
	}
	return "."
}

func InitDB(appDir string) (*gorm.DB, error) {
	dataDir := filepath.Join(appDir, "data")
	themesDir := filepath.Join(appDir, "themes")

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(themesDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(dataDir, "mdreader.db")

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	// AutoMigrate all models
	err = db.AutoMigrate(
		&RecentFile{},
		&Setting{},
		&MonitoredFolder{},
		&IndexedFile{},
		&Tag{},
		&FileTag{},
	)
	if err != nil {
		return nil, err
	}

	// Cleanup any snapshot or invalid entries
	db.Where("path LIKE ?", "%snapshot%").Delete(&RecentFile{})
	db.Where("path LIKE ?", "%snapshot%").Delete(&IndexedFile{})
	db.Where("filePath LIKE ?", "%snapshot%").Delete(&FileTag{})
	db.Where("path LIKE ?", "%.js").Delete(&RecentFile{})

	// Ensure default theme setting
	var themeSetting Setting
	if err := db.First(&themeSetting, "key = ?", "theme").Error; err != nil {
		db.Create(&Setting{Key: "theme", Value: "dark"})
	}

	DB = db
	log.Printf("[DB] Initialized database at %s", dbPath)
	return db, nil
}
