// Package roomdb persists private game snapshots. Live connections and reactions stay in memory.
package roomdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

var ErrInUse = errors.New("room database already in use")

type Store struct {
	db   *sql.DB
	lock *os.File
	path string
}

func Open(path string) (*Store, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrInUse
		}
		return nil, fmt.Errorf("lock room database: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		lock.Close()
		return nil, err
	}
	err = file.Chmod(0600)
	file.Close()
	if err != nil {
		lock.Close()
		return nil, err
	}
	options := url.Values{"_pragma": {"busy_timeout(3000)", "journal_mode(WAL)", "synchronous(FULL)", "secure_delete(ON)"}}
	dsn := url.URL{Scheme: "file", Path: path, RawQuery: options.Encode()}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		lock.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db, lock: lock, path: path}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS room_snapshots (
  game TEXT NOT NULL,
  code TEXT NOT NULL,
  expires INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (game, code)
 ); CREATE INDEX IF NOT EXISTS room_expiry ON room_snapshots(game, expires);`)
	if err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

// SizeBytes reports the combined size of the SQLite database and its write-ahead log.
func (s *Store) SizeBytes() (int64, error) {
	main, err := os.Stat(s.path)
	if err != nil {
		return 0, err
	}
	wal, err := os.Stat(s.path + "-wal")
	if errors.Is(err, os.ErrNotExist) {
		return main.Size(), nil
	}
	if err != nil {
		return 0, err
	}
	return main.Size() + wal.Size(), nil
}

func (s *Store) Close() error {
	err := s.db.Close()
	s.lock.Close()
	return err
}

func (s *Store) Save(game, code string, expires time.Time, state any) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO room_snapshots(game,code,expires,payload) VALUES(?,?,?,?)
  ON CONFLICT(game,code) DO UPDATE SET expires=excluded.expires,payload=excluded.payload`,
		game, code, expires.UnixNano(), payload)
	return err
}

func (s *Store) Touch(game, code string, expires time.Time) error {
	_, err := s.db.Exec("UPDATE room_snapshots SET expires=? WHERE game=? AND code=?", expires.UnixNano(), game, code)
	return err
}

func (s *Store) Sweep(game string, now time.Time) error {
	_, err := s.db.Exec("DELETE FROM room_snapshots WHERE game=? AND expires<=?", game, now.UnixNano())
	return err
}

func Restore[T any](s *Store, game string, now time.Time, ttl time.Duration, setActive func(*T, time.Time)) (map[string]*T, error) {
	if err := s.Sweep(game, now); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("SELECT code,expires,payload FROM room_snapshots WHERE game=?", game)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rooms := make(map[string]*T)
	for rows.Next() {
		var code string
		var expires int64
		var payload []byte
		if err := rows.Scan(&code, &expires, &payload); err != nil {
			return nil, err
		}
		state := new(T)
		if err := json.Unmarshal(payload, state); err != nil {
			return nil, fmt.Errorf("restore %s room %s: %w", game, code, err)
		}
		setActive(state, time.Unix(0, expires).Add(-ttl))
		rooms[code] = state
	}
	return rooms, rows.Err()
}

// Maintain runs garbage collection independently of requests. A separate tick
// batches activity from ephemeral reactions without putting SQL on their send path.
func Maintain(ctx context.Context, interval time.Duration, sweep, flushActivity func()) {
	gc := time.NewTicker(interval)
	defer gc.Stop()
	var activity <-chan time.Time
	if flushActivity != nil {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		activity = ticker.C
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-gc.C:
			sweep()
		case <-activity:
			flushActivity()
		}
	}
}
