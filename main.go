package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/zpatronus/sidequests/internal/abracada"
	"github.com/zpatronus/sidequests/internal/dashboard"
	"github.com/zpatronus/sidequests/internal/formulawar"
	"github.com/zpatronus/sidequests/internal/identity"
	"github.com/zpatronus/sidequests/internal/offercall"
	"github.com/zpatronus/sidequests/internal/roomdb"
	"github.com/zpatronus/sidequests/internal/secrethitler"
	"github.com/zpatronus/sidequests/internal/undercover"
)

//go:embed web/*
var web embed.FS

func handler() http.Handler {
	return mountGames(nil, nil)
}

func persistentHandler(ctx context.Context, db *roomdb.Store) (http.Handler, error) {
	magic, err := abracada.PersistentHandler(ctx, db)
	if err != nil {
		return nil, err
	}
	hitler, err := secrethitler.PersistentHandler(ctx, db)
	if err != nil {
		return nil, err
	}
	return mountGames(magic, hitler), nil
}

func mountGames(magic, hitler http.Handler) http.Handler {
	mux := http.NewServeMux()
	dashboard.Register(mux)
	roomAuth := identity.New()
	if magic == nil {
		magic = roomAuth.Wrap("abracada", "abr_", abracada.Handler())
	}
	if hitler == nil {
		hitler = roomAuth.Wrap("secret-hitler", "sh_", secrethitler.Handler())
	}
	mux.HandleFunc("/identity.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript")
		data, _ := web.ReadFile("web/identity.js")
		w.Write(data)
	})
	mux.HandleFunc("/abracada", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/abracada/", 301) })
	mux.Handle("/abracada/", http.StripPrefix("/abracada", magic))
	mux.HandleFunc("/formula-war", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/formula-war/", http.StatusMovedPermanently)
	})
	mux.Handle("/formula-war/", http.StripPrefix("/formula-war", roomAuth.Wrap("formula-war", "", formulawar.Handler("/formula-war"))))
	mux.HandleFunc("/undercover", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/undercover/", http.StatusMovedPermanently)
	})
	mux.Handle("/undercover/", http.StripPrefix("/undercover", roomAuth.Wrap("undercover", "undercover_", undercover.Handler())))
	mux.HandleFunc("/secret-hitler", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/secret-hitler/", http.StatusMovedPermanently)
	})
	mux.Handle("/secret-hitler/", http.StripPrefix("/secret-hitler", hitler))
	mux.Handle("/offer-call/", http.StripPrefix("/offer-call", offercall.Handler(os.Getenv("OFFER_CALL_SUPABASE_URL"), os.Getenv("OFFER_CALL_SUPABASE_SECRET_KEY"))))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	files, _ := fs.Sub(web, "web")
	static := http.FileServer(http.FS(files))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/style.css" && r.URL.Path != "/favicon.png" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'")
		static.ServeHTTP(w, r)
	})
	return mux
}

func openGameHandler(ctx context.Context, dataDir string) (http.Handler, *roomdb.Store, error) {
	memoryHandler := func() http.Handler {
		return mountGames(abracada.MemoryHandler(ctx), secrethitler.MemoryHandler(ctx))
	}
	if os.Getenv("SIDEQUESTS_STORAGE") == "memory" {
		return memoryHandler(), nil, nil
	}
	db, err := roomdb.Open(filepath.Join(dataDir, "sidequests.sqlite3"))
	if errors.Is(err, roomdb.ErrInUse) {
		return nil, nil, err
	}
	if err != nil {
		log.Printf("SQLite unavailable, using in-memory rooms: %v", err)
		return memoryHandler(), nil, nil
	}
	app, err := persistentHandler(ctx, db)
	if err != nil {
		db.Close()
		return nil, nil, err
	}
	return app, db, nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	dataDir := os.Getenv("SIDEQUESTS_DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	app, db, err := openGameHandler(ctx, dataDir)
	if err != nil {
		log.Fatal(err)
	}
	if db != nil {
		defer db.Close()
	}
	server := &http.Server{Addr: ":" + port, Handler: app, BaseContext: func(net.Listener) context.Context { return ctx }, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("sidequests listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-stopped
}
