package abracada

import (
	"embed"

	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/zpatronus/sidequests/internal/roomdb"
)

//go:embed web/index.html web/style.css web/app.js web/layout.mjs web/art/* web/fonts/*
var assets embed.FS

const roomIdleTTL = 15 * time.Minute

type room struct {
	Pins           roomdb.Pins
	ActionReceipts []actionReceipt
	activityDirty  bool
	Code, Host     string
	Members        []member
	Tokens         map[string]string
	Bots           int
	LobbyVersion   int
	Game           *game
	Active         time.Time
	listeners      map[chan struct{}]struct{}
	worker         bool
	reactions      map[chan reaction]struct{}
}
type server struct {
	pinAuth bool
	storage *roomdb.Store
	done    <-chan struct{}
	mu      sync.Mutex
	rooms   map[string]*room
	now     func() time.Time
}
type roomView struct {
	Code         string    `json:"code"`
	Host         string    `json:"host"`
	You          string    `json:"you"`
	Members      []member  `json:"members"`
	Bots         int       `json:"bots"`
	LobbyVersion int       `json:"lobbyVersion"`
	Game         *gameView `json:"game,omitempty"`
}

func (r *room) view(id string) roomView {
	v := roomView{Code: r.Code, Host: r.Host, You: id, Members: append([]member(nil), r.Members...), Bots: r.Bots, LobbyVersion: r.LobbyVersion}
	if r.Game != nil {
		v.Game = r.Game.view(id)
	}
	return v
}
func Handler() http.Handler { return (&server{rooms: map[string]*room{}, now: time.Now}).handler() }
func (s *server) handler() http.Handler {
	files, _ := fs.Sub(assets, "web")
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if q.URL.Path == "/api/events" {
			s.events(w, q)
			return
		}
		if strings.HasPrefix(q.URL.Path, "/api/") {
			s.api(w, q)
			return
		}
		if q.Method != "GET" && q.Method != "HEAD" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		path := q.URL.Path
		if path != "/" && path != "/style.css" && path != "/app.js" && path != "/layout.mjs" &&
			path != "/fonts/noto-color-emoji-reactions.woff2" && path != "/fonts/OFL.txt" && !strings.HasPrefix(path, "/art/") {
			http.NotFound(w, q)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if path == "/fonts/noto-color-emoji-reactions.woff2" {
			w.Header().Set("Content-Type", "font/woff2")
		}
		static.ServeHTTP(w, q)
	})
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}
func validName(name string) bool {
	return utf8.RuneCountInString(name) > 0 && utf8.RuneCountInString(name) <= 20 && !strings.ContainsAny(name, "\r\n\t")
}
func cookie(w http.ResponseWriter, q *http.Request, code, value string) {
	http.SetCookie(w, &http.Cookie{Name: "abr_" + code, Value: value, Path: "/abracada/", HttpOnly: true, Secure: q.TLS != nil || q.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteStrictMode, MaxAge: 86400})
}
func (r *room) notify() {
	for ch := range r.listeners {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
func (s *server) clean() {
	for code, r := range s.rooms {
		if s.now().Sub(r.Active) >= roomIdleTTL {
			delete(s.rooms, code)
			r.notify()
		}
	}
}

type request struct {
	RequestID    string `json:"requestId"`
	LobbyVersion *int   `json:"lobbyVersion"`
	Username     string `json:"username"`
	PIN          string `json:"pin"`
	NewPIN       string `json:"newPin"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Game         string `json:"game"`
	Step         int    `json:"step"`
	Spell        int    `json:"spell"`
	Slot         int    `json:"slot"`
	Count        int    `json:"count"`
	Emoji        string `json:"emoji"`
	Roll         int    `json:"roll"`
}

func (s *server) api(w http.ResponseWriter, q *http.Request) {
	if q.Method != "GET" && q.Method != "POST" {
		fail(w, 405, "请求方式不支持")
		return
	}
	if q.Method == "POST" {
		if q.Header.Get("Sec-Fetch-Site") == "cross-site" {
			fail(w, 403, "请在本站操作")
			return
		}
		if origin := q.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || !strings.EqualFold(u.Host, q.Host) || (u.Scheme != "http" && u.Scheme != "https") {
				fail(w, 403, "请在本站操作")
				return
			}
		}
		if q.Header.Get("Content-Type") != "application/json" {
			fail(w, 415, "需要 JSON 请求")
			return
		}
	}
	var in request
	if q.Method == "POST" {
		if json.NewDecoder(http.MaxBytesReader(w, q.Body, 2048)).Decode(&in) != nil {
			fail(w, 400, "输入格式有误")
			return
		}
	} else {
		in.Code = q.URL.Query().Get("code")
		in.Username = q.URL.Query().Get("username")
		in.PIN = q.URL.Query().Get("pin")
	}
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.Name = strings.TrimSpace(in.Name)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done == nil {
		s.clean()
	}
	action := strings.TrimPrefix(q.URL.Path, "/api/")
	if action == "emojis" && q.Method == "GET" {
		respond(w, 200, emojiGroups)
		return
	}
	var credential string
	if s.pinAuth {
		if q.URL.Path == "/api/create" {
			in.Code = ""
		}
		name := strings.TrimSpace(in.Username)
		if name == "" {
			name = in.Name
		}
		if !roomdb.ValidLogin(name, in.PIN) {
			fail(w, 403, "请填写用户名和 4 位 PIN")
			return
		}
		entry := q.URL.Path == "/api/create" || q.URL.Path == "/api/join"
		if entry && !strings.EqualFold(name, in.Name) {
			fail(w, 400, "用户名与昵称不一致")
			return
		}
		if r := s.rooms[in.Code]; r != nil && !s.now().Before(roomExpiry(r)) {
			fail(w, 404, "房间不存在或已过期")
			return
		}
		if s.storage != nil && q.URL.Path != "/api/react" {
			recorded, commit := roomdb.Record(w, s.storage, storageGame, &in.Code, s.rooms, roomExpiry, restoreRoom, fail)
			w = recorded
			defer commit()
		}
		if r := s.rooms[in.Code]; r != nil && s.now().Before(roomExpiry(r)) && q.URL.Path != "/api/create" {
			r.Active = s.now()
			if s.storage != nil && q.URL.Path == "/api/react" {
				r.activityDirty = true
			}
			var status int
			credential, status = r.Pins.Authenticate(in.Code, name, in.PIN, s.now())
			if status != 0 {
				fail(w, status, roomdb.LoginError(status))
				return
			}
			if q.URL.Path == "/api/pin" && q.Method == "POST" {
				if r.Tokens[credential] == "" {
					fail(w, 403, "请先加入房间")
					return
				}
				if !roomdb.ValidLogin(name, in.NewPIN) {
					fail(w, 400, "新 PIN 必须是 4 位数字")
					return
				}
				r.Pins.Set(in.Code, name, in.NewPIN, credential)
				respond(w, 200, map[string]bool{"changed": true})
				return
			}
		}
	}
	if action == "create" && q.Method == "POST" {
		if !validName(in.Name) {
			fail(w, 400, "昵称需要 1–20 个字")
			return
		}
		if s.activeRooms(s.now()) >= 100 {
			fail(w, 503, "房间已满")
			return
		}
		code := strings.ToUpper(token(3))
		for s.rooms[code] != nil {
			code = strings.ToUpper(token(3))
		}
		id, key := token(8), token(24)
		r := &room{Code: code, Host: id, Members: []member{{id, in.Name, false}}, Tokens: map[string]string{key: id}, Bots: 1, Active: s.now()}
		s.rooms[code] = r
		if s.pinAuth {
			in.Code = code
			r.Pins.Set(code, in.Name, in.PIN, key)
		}
		if !s.pinAuth {
			cookie(w, q, code, key)
		}
		respond(w, 201, r.view(id))
		return
	}
	r := s.rooms[in.Code]
	if r == nil || !s.now().Before(roomExpiry(r)) {
		fail(w, 404, "房间不存在或已因 15 分钟无活动而关闭")
		return
	}
	r.Active = s.now()
	id := ""
	if s.pinAuth {
		id = r.Tokens[credential]
	} else if c, err := q.Cookie("abr_" + r.Code); err == nil {
		id = r.Tokens[c.Value]
	}
	index := -1
	for i, m := range r.Members {
		if m.ID == id {
			index = i
			break
		}
	}
	if action == "join" && q.Method == "POST" {
		if index >= 0 {
			r.Active = s.now()
			respond(w, 200, r.view(id))
			return
		}
		if r.Game != nil {
			fail(w, 409, "本局已经开始；已有玩家可用用户名和 PIN 重连")
			return
		}
		if len(r.Members) >= 6 {
			fail(w, 409, "最多 6 位魔法师")
			return
		}
		if !validName(in.Name) {
			fail(w, 400, "昵称需要 1–20 个字")
			return
		}
		for _, m := range r.Members {
			if m.Name == in.Name {
				fail(w, 409, "昵称已被使用")
				return
			}
		}
		id, key := token(8), token(24)
		r.Members = append(r.Members, member{id, in.Name, false})
		r.Tokens[key] = id
		if s.pinAuth {
			r.Pins.Set(r.Code, in.Name, in.PIN, key)
		}
		if len(r.Members) == 1 {
			r.Host = id
		}
		r.Bots = min(r.Bots, 6-len(r.Members))
		r.LobbyVersion++
		r.Active = s.now()
		r.notify()
		if !s.pinAuth {
			cookie(w, q, r.Code, key)
		}
		respond(w, 200, r.view(id))
		return
	}
	if index < 0 {
		fail(w, 403, "请先加入房间")
		return
	}
	r.Active = s.now()
	if q.Method == "GET" {
		switch action {
		case "room":
			respond(w, 200, r.view(id))
		case "tablets":
			if r.Game == nil {
				fail(w, 409, "游戏尚未开始")
				return
			}
			p := r.Game.Players[r.Game.index(id)]
			respond(w, 200, map[string]any{"game": r.Game.ID, "round": r.Game.Round, "tablets": append([]int{}, p.Tablets...)})
		default:
			fail(w, 404, "接口不存在")
		}
		return
	}
	var requestKey actionKey
	if in.RequestID != "" && isRepeatableAction(action) {
		if !validRequestID(in.RequestID) {
			fail(w, 400, "请求编号无效")
			return
		}
		requestKey = in.actionKey(action)
		for _, receipt := range r.ActionReceipts {
			if receipt.Player != id || receipt.ID != in.RequestID {
				continue
			}
			if receipt.Action != requestKey {
				fail(w, 409, "请求编号已用于其他操作")
				return
			}
			respond(w, 200, receipt.Result)
			return
		}
	}
	if (action == "start" || action == "bots") &&
		((in.LobbyVersion != nil && *in.LobbyVersion != r.LobbyVersion) ||
			(in.RequestID != "" && in.LobbyVersion == nil)) {
		fail(w, 409, "等待室状态已更新，请重试")
		return
	}
	if action != "react" {
		defer r.notify()
	}
	switch action {
	case "react":
		if r.Game == nil || !allowedEmoji[in.Emoji] {
			fail(w, 400, "请选择一个表情")
			return
		}
		r.sendReaction(reaction{Player: id, Emoji: in.Emoji})
		respond(w, 200, map[string]bool{"sent": true})
		return
	case "bots":
		if id != r.Host || r.Game != nil {
			fail(w, 403, "只有房主可在等待时设置机器人")
			return
		}
		if in.Count < 0 || in.Count > 6-len(r.Members) {
			fail(w, 400, "总人数不得超过 6 人")
			return
		}
		r.Bots = in.Count
		r.LobbyVersion++
	case "start":
		if id != r.Host || r.Game != nil {
			fail(w, 403, "只有房主可以开始游戏")
			return
		}
		all := append([]member(nil), r.Members...)
		for i := 0; i < r.Bots; i++ {
			all = append(all, member{ID: "bot-" + token(8), Name: fmtBot(i), Bot: true})
		}
		for i := len(all) - 1; i > 0; i-- {
			j := random(i + 1)
			all[i], all[j] = all[j], all[i]
		}
		first := 0
		if len(all) > 0 {
			first = random(len(all))
		}
		g, e := newGame(all, first)
		if e != nil {
			fail(w, 400, e.Error())
			return
		}
		r.Game = g
		r.LobbyVersion++
	case "next":
		if id != r.Host || r.Game == nil || in.Game != r.Game.ID || in.Step != r.Game.Step || r.Game.Phase != "round-end" {
			fail(w, 409, "等待房主开始下一轮")
			return
		}
		r.Game.beginRound(r.Game.Next)
	case "reset":
		if id != r.Host || r.Game == nil || in.Game != r.Game.ID || r.Game.Phase != "finished" {
			fail(w, 409, "只能在游戏结束后重新开局")
			return
		}
		r.Game = nil
		r.LobbyVersion++
	case "leave":
		if r.Game != nil && r.Game.Phase != "finished" {
			fail(w, 409, "游戏中会保留席位，可用用户名和 PIN 重新连接")
			return
		}
		r.Members = append(r.Members[:index], r.Members[index+1:]...)
		r.LobbyVersion++
		for key, owner := range r.Tokens {
			if owner == id {
				delete(r.Tokens, key)
			}
		}
		r.Pins.Prune(r.Tokens)
		if len(r.Members) == 0 {
			r.Host = ""
			r.Game = nil
		} else if r.Host == id {
			r.Host = r.Members[0].ID
		}
		if !s.pinAuth {
			cookie(w, q, r.Code, "")
		}
		respond(w, 200, map[string]bool{"left": true})
		return
	case "cast", "end", "take", "roll":
		if r.Game == nil || in.Game != r.Game.ID || in.Step != r.Game.Step {
			fail(w, 409, "游戏状态已更新，请重试")
			return
		}
		var err error
		if action == "roll" {
			err = r.Game.actRoll(id, in.Roll)
		} else {
			err = r.Game.actHuman(id, action, in.Spell, in.Slot)
		}
		if err != nil {
			fail(w, 409, err.Error())
			return
		}
	default:
		fail(w, 404, "接口不存在")
		return
	}
	s.runBots(r)
	result := r.view(id)
	if requestKey.Action != "" {
		r.rememberAction(id, in.RequestID, requestKey, result)
	}
	respond(w, 200, result)
}
func fmtBot(i int) string {
	return []string{"星尘学徒", "苔藓术士", "月光使者", "迷雾巫师", "琥珀法师"}[i]
}

// A bot receives exactly the information that its human seat would see.
func botMove(v *gameView, id string, tablets []int) (string, int, int) {
	if v.Phase == "owl" {
		for i, available := range v.Secrets {
			if available {
				return "take", 0, i
			}
		}
	}
	var own playerView
	unseen := v.Supply
	for k := range unseen {
		unseen[k] -= v.Removed[k] + v.Used[k]
	}
	for _, p := range v.Players {
		if p.ID == id {
			own = p
			continue
		}
		for _, k := range p.Hand {
			if k > 0 {
				unseen[k-1]--
			}
		}
	}
	for _, k := range tablets {
		unseen[k-1]--
	}
	total := 0
	weights := [8]int{}
	for i, n := range unseen {
		if i+1 < v.Minimum {
			continue
		}
		weight := max(0, n)
		if i == 7 && own.Life >= 5 {
			weight /= 2
		}
		if i == 3 {
			available := false
			for _, b := range v.Secrets {
				available = available || b
			}
			if !available {
				weight /= 2
			}
		}
		weights[i] = weight
		total += weight
	}
	if v.CanEnd && (total == 0 || len(own.Hand) > 1 && random(4) == 0) {
		return "end", 0, 0
	}
	if total == 0 {
		return "cast", max(1, v.Minimum), 0
	}
	choice := random(total)
	for i, w := range weights {
		choice -= w
		if choice < 0 {
			return "cast", i + 1, 0
		}
	}
	return "cast", 8, 0
}

const botActionDelay = 4 * time.Second

func botCanAct(g *game) bool {
	return g != nil && (g.Phase == "playing" || g.Phase == "owl") && g.Players[g.Turn].Member.Bot
}
func (s *server) runBots(r *room) {
	if r.worker || !botCanAct(r.Game) {
		return
	}
	r.worker = true
	go func() {
		for {
			s.mu.Lock()
			g := r.Game
			if s.rooms[r.Code] != r || (s.done != nil && !s.now().Before(roomExpiry(r))) || !botCanAct(g) {
				r.worker = false
				s.mu.Unlock()
				return
			}
			step := g.Step
			s.mu.Unlock()
			if !s.waitBot(botActionDelay) {
				return
			}
			s.mu.Lock()
			if s.rooms[r.Code] != r || (s.done != nil && !s.now().Before(roomExpiry(r))) || r.Game != g || g.Step != step {
				s.mu.Unlock()
				continue
			}
			before := s.beforeBot(r)
			p := g.Players[g.Turn]
			action, kind, slot := botMove(g.view(p.Member.ID), p.Member.ID, append([]int(nil), p.Tablets...))
			if err := g.act(p.Member.ID, action, kind, slot); err == nil && s.saveBot(r, before) {
				r.notify()
			}
			s.mu.Unlock()
		}
	}()
}
