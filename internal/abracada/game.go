package abracada

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
)

// Spell kinds and IDs stay stable internally; six-player supply adds one stone to kinds 2–8.
var spellNames = [8]string{"远古巨龙", "黑暗幽灵", "甜蜜的梦", "猫头鹰", "闪电风暴", "冰晶术", "火球术", "治疗药水"}
var standard = [8]int{1, 2, 3, 4, 5, 6, 7, 8}
var expanded = [8]int{1, 3, 4, 5, 6, 7, 8, 9}
var spellIDs = [8]int{1, 2, 3, 4, 5, 6, 7, 8}

type member struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Bot  bool   `json:"bot"`
}
type wizard struct {
	Member            member
	Life, Score, Gain int
	Hand, Tablets     []int
}
type event struct {
	ID      int      `json:"id"`
	Round   int      `json:"round"`
	Actor   string   `json:"actor,omitempty"`
	Kind    string   `json:"kind"`
	Spell   int      `json:"spell,omitempty"`
	Success bool     `json:"success"`
	Roll    int      `json:"roll,omitempty"`
	Targets []string `json:"targets,omitempty"`
	Text    string   `json:"text"`
}
type pendingCast struct {
	Actor, Kind, Position, EventIndex int
	Success                           bool
}
type game struct {
	ID                                      string
	Players                                 []wizard
	Supply, IDs, Removed, Used              [8]int
	Deck, Secrets                           []int
	Phase                                   string
	Round, Step, Turn, Last, Next, Sequence int
	Events                                  []event
	Reason                                  string
	Winners                                 []string
	Pending                                 *pendingCast
	roll                                    func() int
}

func (g *game) rollDie() int {
	if g.roll != nil {
		return g.roll()
	}
	return random(3) + 1
}

func random(n int) int {
	v, e := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if e != nil {
		panic(e)
	}
	return int(v.Int64())
}
func token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func newGame(members []member, first int) (*game, error) {
	if len(members) < 2 || len(members) > 6 || first < 0 || first >= len(members) {
		return nil, errors.New("需要 2–6 位魔法师")
	}
	g := &game{ID: token(8), Supply: standard, IDs: spellIDs, Last: -1, roll: func() int { return random(3) + 1 }}
	if len(members) == 6 {
		g.Supply = expanded
	}
	for _, m := range members {
		g.Players = append(g.Players, wizard{Member: m})
	}
	g.beginRound(first)
	return g, nil
}
func (g *game) log(e event) {
	g.Sequence++
	e.ID = g.Sequence
	e.Round = g.Round
	g.Events = append(g.Events, e)
}
func (g *game) beginRound(first int) {
	g.Round++
	g.Step++
	g.Pending = nil
	g.Turn = first
	g.Last = -1
	g.Phase = "playing"
	g.Reason = ""
	g.Removed = [8]int{}
	g.Used = [8]int{}
	g.Deck = nil
	g.Secrets = nil
	for kind, n := range g.Supply {
		for i := 0; i < n; i++ {
			g.Deck = append(g.Deck, kind+1)
		}
	}
	for i := len(g.Deck) - 1; i > 0; i-- {
		j := random(i + 1)
		g.Deck[i], g.Deck[j] = g.Deck[j], g.Deck[i]
	}
	for i := range g.Players {
		p := &g.Players[i]
		p.Life = 6
		p.Gain = 0
		p.Hand = g.draw(5)
		p.Tablets = nil
	}
	remove := 0
	if len(g.Players) == 2 {
		remove = 12
	}
	if len(g.Players) == 3 {
		remove = 6
	}
	for _, kind := range g.draw(remove) {
		g.Removed[kind-1]++
	}
	g.Secrets = g.draw(g.Supply[3])
	g.log(event{Kind: "round", Text: fmt.Sprintf("第 %d 轮开始，%s 先施法；按逆时针顺序行动", g.Round, g.Players[first].Member.Name)})
}
func (g *game) draw(n int) []int {
	n = min(n, len(g.Deck))
	out := append([]int(nil), g.Deck[:n]...)
	g.Deck = g.Deck[n:]
	return out
}
func (g *game) index(id string) int {
	for i, p := range g.Players {
		if p.Member.ID == id {
			return i
		}
	}
	return -1
}

// Seat order is counterclockwise: next is the caster's right-hand neighbor.
func (g *game) left(i int) int  { return (i + len(g.Players) - 1) % len(g.Players) }
func (g *game) right(i int) int { return (i + 1) % len(g.Players) }
func (g *game) endTurn() {
	p := &g.Players[g.Turn]
	p.Hand = append(p.Hand, g.draw(5-len(p.Hand))...)
	g.Turn = g.right(g.Turn)
	g.Last = -1
}

func (g *game) actRoll(id string, value int) error {
	if g.Phase != "rolling" || g.Pending == nil || g.Players[g.Pending.Actor].Member.ID != id {
		return errors.New("当前没有等待你的掷骰")
	}
	if value < 1 || value > 3 {
		return errors.New("骰子点数必须是 1–3")
	}
	pending := *g.Pending
	g.Pending = nil
	g.Phase = "playing"
	e := &g.Events[pending.EventIndex]
	e.Roll = value
	g.resolveCast(pending.Actor, pending.Kind, pending.Position, pending.Success, e)
	g.Step++
	return nil
}

func (g *game) resolveCast(actor, kind, position int, success bool, e *event) {
	p := &g.Players[actor]
	label := fmt.Sprintf("%d 号%s", g.IDs[kind-1], spellNames[kind-1])
	if !success {
		loss := 1
		if kind == 1 {
			if e.Roll == 0 {
				e.Roll = g.rollDie()
			}
			loss = e.Roll
		}
		p.Life = max(0, p.Life-loss)
		e.Text = fmt.Sprintf("%s 尝试%s失败，反噬失去 %d 点生命", p.Member.Name, label, loss)
		if !g.finishIfNeeded() {
			g.endTurn()
		}
		return
	}
	p.Hand = append(p.Hand[:position], p.Hand[position+1:]...)
	g.Used[kind-1]++
	g.Last = kind - 1
	damage := map[int]int{}
	switch kind {
	case 1:
		if e.Roll == 0 {
			e.Roll = g.rollDie()
		}
		for i := range g.Players {
			if i != actor {
				damage[i] = e.Roll
			}
		}
	case 2:
		for i := range g.Players {
			if i != actor {
				damage[i] = 1
			}
		}
		p.Life = min(6, p.Life+1)
	case 3:
		if e.Roll == 0 {
			e.Roll = g.rollDie()
		}
		p.Life = min(6, p.Life+e.Roll)
	case 4:
		for _, k := range g.Secrets {
			if k != 0 {
				g.Phase = "owl"
				break
			}
		}
	case 5:
		damage[g.left(actor)] = 1
		damage[g.right(actor)] = 1
	case 6:
		damage[g.left(actor)] = 1
	case 7:
		damage[g.right(actor)] = 1
	case 8:
		p.Life = min(6, p.Life+1)
	}
	for i := range g.Players {
		if n := damage[i]; n > 0 {
			g.Players[i].Life = max(0, g.Players[i].Life-n)
			e.Targets = append(e.Targets, g.Players[i].Member.ID)
		}
	}
	e.Text = p.Member.Name + " 成功施放" + label
	if e.Roll > 0 {
		e.Text += fmt.Sprintf("，骰出 %d 点", e.Roll)
	}
	if g.Phase != "owl" {
		g.finishIfNeeded()
	}
}
func (g *game) finishIfNeeded() bool {
	actor := g.Turn
	p := &g.Players[actor]
	empty := len(p.Hand) == 0
	dead := false
	for _, w := range g.Players {
		if w.Life == 0 {
			dead = true
		}
	}
	if !empty && !dead {
		return false
	}
	winner := -1
	if empty {
		winner = actor
		g.Reason = p.Member.Name + " 施放完全部魔法石"
		for i := range g.Players {
			if i != actor {
				g.Players[i].Life = 0
			}
		}
	} else if p.Life == 0 {
		g.Reason = p.Member.Name + " 施法反噬，生命耗尽"
	} else {
		winner = actor
		g.Reason = p.Member.Name + " 击败了其他魔法师"
	}
	for i := range g.Players {
		w := &g.Players[i]
		w.Gain = 0
		if w.Life > 0 {
			w.Gain = 1
			if i == winner {
				w.Gain = 3
			}
			w.Gain += len(w.Tablets)
		}
		w.Score += w.Gain
	}
	g.Next = actor
	g.Phase = "round-end"
	g.log(event{Kind: "score", Actor: p.Member.ID, Text: g.Reason + "，本轮计分"})
	contenders := []int{}
	for i, w := range g.Players {
		if w.Score >= 8 {
			contenders = append(contenders, i)
		}
	}
	if len(contenders) > 0 {
		g.Phase = "finished"
		g.log(event{Kind: "victory", Text: "有人抵达 8 分高塔，游戏结束"})
		if winner >= 0 && g.Players[winner].Score >= 8 {
			g.Winners = append(g.Winners, g.Players[winner].Member.ID)
			return true
		}
		best := contenders[0]
		for _, i := range contenders {
			if g.Players[i].Gain > g.Players[best].Gain || (g.Players[i].Gain == g.Players[best].Gain && g.Players[i].Life > g.Players[best].Life) {
				best = i
			}
		}
		for _, i := range contenders {
			if g.Players[i].Gain == g.Players[best].Gain && g.Players[i].Life == g.Players[best].Life {
				g.Winners = append(g.Winners, g.Players[i].Member.ID)
			}
		}
	}
	return true
}
func (g *game) act(id, action string, kind, slot int) error {
	return g.actWithRoll(id, action, kind, slot, 0, false)
}
func (g *game) actHuman(id, action string, kind, slot int) error {
	return g.actWithRoll(id, action, kind, slot, 0, true)
}
func (g *game) actWithRoll(id, action string, kind, slot, roll int, human bool) error {
	if g.index(id) != g.Turn {
		return errors.New("还没轮到你")
	}
	if g.Phase == "owl" {
		if action != "take" {
			return errors.New("请先选择一个秘法石板")
		}
		if slot < 0 || slot >= len(g.Secrets) || g.Secrets[slot] == 0 {
			return errors.New("这个秘法石板已被取走")
		}
		p := &g.Players[g.Turn]
		p.Tablets = append(p.Tablets, g.Secrets[slot])
		g.Secrets[slot] = 0
		g.Phase = "playing"
		g.Step++
		g.log(event{Kind: "tablet", Actor: id, Text: p.Member.Name + " 取走一个秘法石板（内容仅本人可见）"})
		g.finishIfNeeded()
		return nil
	}
	if g.Phase != "playing" {
		return errors.New("本轮已经结束")
	}
	if action == "end" {
		if g.Last < 0 {
			return errors.New("每回合至少尝试一次施法")
		}
		g.log(event{Kind: "pass", Actor: id, Text: g.Players[g.Turn].Member.Name + " 结束回合并补牌"})
		g.endTurn()
		g.Step++
		return nil
	}
	if action != "cast" || kind < 1 || kind > 8 {
		return errors.New("请选择一个法术")
	}
	if kind-1 < g.Last {
		return errors.New("连续施法的编号不能降低")
	}
	p := &g.Players[g.Turn]
	position := -1
	for i, k := range p.Hand {
		if k == kind {
			position = i
			break
		}
	}
	e := event{Kind: "cast", Actor: id, Spell: kind, Success: position >= 0}
	g.Step++
	needsRoll := kind == 1 || (position >= 0 && kind == 3)
	if needsRoll && human && p.Member.Bot == false {
		g.Phase = "rolling"
		e.Text = fmt.Sprintf("%s 正在施放 %d 号%s", p.Member.Name, g.IDs[kind-1], spellNames[kind-1])
		g.log(e)
		g.Pending = &pendingCast{Actor: g.Turn, Kind: kind, Position: position, EventIndex: len(g.Events) - 1, Success: position >= 0}
		return nil
	}
	if needsRoll {
		e.Roll = roll
		if e.Roll == 0 {
			e.Roll = g.rollDie()
		}
	}
	g.log(e)
	g.resolveCast(g.Turn, kind, position, position >= 0, &g.Events[len(g.Events)-1])
	return nil
}

type playerView struct {
	member
	Life    int    `json:"life"`
	Score   int    `json:"score"`
	Gain    int    `json:"gain"`
	Hand    []int  `json:"hand"`
	Tablets int    `json:"tablets"`
	Left    string `json:"left"`
	Right   string `json:"right"`
}
type gameView struct {
	ID      string       `json:"id"`
	Phase   string       `json:"phase"`
	Round   int          `json:"round"`
	Step    int          `json:"step"`
	Turn    string       `json:"turn"`
	Minimum int          `json:"minimum"`
	CanEnd  bool         `json:"canEnd"`
	Players []playerView `json:"players"`
	Supply  [8]int       `json:"supply"`
	IDs     [8]int       `json:"ids"`
	Removed [8]int       `json:"removed"`
	Used    [8]int       `json:"used"`
	Deck    int          `json:"deck"`
	Secrets []bool       `json:"secrets"`
	Events  []event      `json:"events"`
	Reason  string       `json:"reason"`
	Winners []string     `json:"winners"`
}

func (g *game) view(id string) *gameView {
	v := &gameView{ID: g.ID, Phase: g.Phase, Round: g.Round, Step: g.Step, Turn: g.Players[g.Turn].Member.ID, Minimum: g.Last + 1, CanEnd: g.Last >= 0, Supply: g.Supply, IDs: g.IDs, Removed: g.Removed, Used: g.Used, Deck: len(g.Deck), Events: append([]event(nil), g.Events...), Reason: g.Reason, Winners: append([]string(nil), g.Winners...)}
	for i, p := range g.Players {
		hand := make([]int, len(p.Hand))
		if p.Member.ID != id || g.Phase == "round-end" || g.Phase == "finished" {
			copy(hand, p.Hand)
		}
		v.Players = append(v.Players, playerView{member: p.Member, Life: p.Life, Score: p.Score, Gain: p.Gain, Hand: hand, Tablets: len(p.Tablets), Left: g.Players[g.left(i)].Member.ID, Right: g.Players[g.right(i)].Member.ID})
	}
	for _, k := range g.Secrets {
		v.Secrets = append(v.Secrets, k != 0)
	}
	return v
}
