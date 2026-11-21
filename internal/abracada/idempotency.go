package abracada

import (
	"encoding/hex"
	"encoding/json"
)

const maxActionReceipts = 32

type actionKey struct {
	Action, Game                   string
	Step, Spell, Slot, Count, Roll int
	LobbyVersion                   int
}

type actionReceipt struct {
	Player, ID string
	Action     actionKey
	Result     json.RawMessage
}

func isRepeatableAction(action string) bool {
	switch action {
	case "bots", "start", "cast", "roll", "end", "take", "next", "reset":
		return true
	default:
		return false
	}
}

func validRequestID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

func (r request) actionKey(action string) actionKey {
	lobbyVersion := -1
	if r.LobbyVersion != nil {
		lobbyVersion = *r.LobbyVersion
	}
	return actionKey{
		Action: action, Game: r.Game, Step: r.Step,
		Spell: r.Spell, Slot: r.Slot, Count: r.Count, Roll: r.Roll,
		LobbyVersion: lobbyVersion,
	}
}

func (r *room) rememberAction(player, id string, action actionKey, view roomView) {
	// Serialize now, so later moves cannot change slices in a saved response.
	result, err := json.Marshal(view)
	if err != nil {
		panic(err)
	}
	if len(r.ActionReceipts) >= maxActionReceipts {
		copy(r.ActionReceipts, r.ActionReceipts[1:])
		r.ActionReceipts = r.ActionReceipts[:len(r.ActionReceipts)-1]
	}
	r.ActionReceipts = append(r.ActionReceipts, actionReceipt{Player: player, ID: id, Action: action, Result: result})
}
