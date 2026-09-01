package database

import (
	"time"
)

type RecentFile struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Path       string    `gorm:"uniqueIndex;not null" json:"path"`
	Name       string    `gorm:"not null" json:"name"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	LastOpened time.Time `gorm:"column:last_opened;autoCreateTime;autoUpdateTime" json:"last_opened"`
}

func (RecentFile) TableName() string {
	return "recent_files"
}

type Setting struct {
	Key   string `gorm:"primaryKey" json:"key"`
	Value string `gorm:"not null" json:"value"`
}

func (Setting) TableName() string {
	return "settings"
}

type MonitoredFolder struct {
	ID                uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	Path              string     `gorm:"uniqueIndex;not null" json:"path"`
	IncludeSubfolders bool       `gorm:"column:includeSubfolders;default:false" json:"includeSubfolders"`
	Active            bool       `gorm:"column:active;default:true" json:"active"`
	LastScanned       *time.Time `gorm:"column:lastScanned" json:"lastScanned"`
}

func (MonitoredFolder) TableName() string {
	return "monitored_folders"
}

type IndexedFile struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Path      string    `gorm:"uniqueIndex;not null" json:"path"`
	Name      string    `gorm:"not null" json:"name"`
	FolderID  uint      `gorm:"column:folderId;index;not null" json:"folderId"`
	IndexedAt time.Time `gorm:"column:indexedAt;autoCreateTime" json:"indexedAt"`
}

func (IndexedFile) TableName() string {
	return "indexed_files"
}

type Tag struct {
	ID    uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	Name  string `gorm:"uniqueIndex;not null" json:"name"`
	Color string `gorm:"default:'#6c8cff'" json:"color"`
}

func (Tag) TableName() string {
	return "tags"
}

type FileTag struct {
	ID       uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	FilePath string `gorm:"column:filePath;uniqueIndex:idx_file_tag;not null" json:"filePath"`
	TagID    uint   `gorm:"column:tagId;uniqueIndex:idx_file_tag;index;not null" json:"tagId"`
}

func (FileTag) TableName() string {
	return "file_tags"
}
