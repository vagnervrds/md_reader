package server

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:public
var embeddedPublic embed.FS

func StaticFileServer() http.Handler {
	sub, err := fs.Sub(embeddedPublic, "public")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")

		// If path doesn't have an extension and isn't root, check if index.html should be served
		path := r.URL.Path
		if path != "/" && !strings.Contains(path, ".") {
			// e.g. /file/123
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	})
}
