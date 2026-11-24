package abracada

// Reactions travel only to current SSE listeners and are never stored in game history.
type reaction struct {
	Player string `json:"player"`
	Emoji  string `json:"emoji"`
	Target string `json:"target,omitempty"`
}
type emojiGroup struct {
	Name   string   `json:"name"`
	Emojis []string `json:"emojis"`
}

var emojiGroups = []emojiGroup{
	{"符号", []string{"❓", "❔", "❗", "❕", "⁉️", "‼️", "㊗️", "🈲", "🔞", "🚫", "⛔", "🛑", "⚠️", "💢", "💬", "💭", "🔔", "🚨", "✅", "❌"}},
	{"挑衅", []string{"🖕", "🗑️", "😼", "😾", "😬", "😮‍💨", "😖", "😠", "🙈", "🙉", "🙊", "🫣", "🤫", "🤥", "😶‍🌫️", "🫤"}},
	{"对决", []string{"⚔️", "🛡️", "🧨", "💣", "🧯", "🥊", "🪓", "🏹", "🎲", "🃏", "🕳️", "⏳", "☄️", "🌋", "🫸", "🫷"}},
	{"笑与搞怪", []string{"😂", "🤣", "😆", "😁", "😅", "😎", "🤡", "💀", "☠️", "👻", "💩", "🗿", "🤪", "😜", "😝", "🙃", "🫠", "😏", "🤭", "🫢"}},
	{"情绪", []string{"😭", "🥲", "🥹", "🥺", "😢", "😤", "😡", "🤬", "😱", "😨", "😳", "🤯", "😵‍💫", "😵", "🤔", "🧐", "🙄", "😒", "😑", "😴"}},
	{"手势", []string{"👍", "👎", "👏", "🙌", "🤝", "🙏", "🫡", "👌", "🤌", "✌️", "🤞", "💪", "👊", "🤜", "🤛", "🤏", "🫵", "👀", "🤷", "🤦"}},
	{"庆祝", []string{"🎉", "🎊", "🥳", "🏆", "👑", "💯", "🔥", "✨", "🌟", "⭐", "💥", "💨", "🚀", "🎯", "🧠", "🍿", "🧂", "🍋", "🐸", "🐷"}},
	{"魔法", []string{"🪄", "🔮", "🦉", "🐉", "👹", "👺", "👽", "🤖", "😈", "👿", "🧙", "🧟", "🧛", "⚡", "❄️", "🌪️", "🌙", "🧊", "💊", "🪦", "🧪", "⚗️", "🫧", "🕯️", "📜", "🐈‍⬛", "🕷️", "🕸️", "🦇", "🦴", "🌚", "🌝"}},
	{"食物与饮料", []string{"🍵", "🫖", "🍅", "🥚", "🍳", "☕", "🧋", "🥛", "🧃", "🍺", "🌶️", "🥔", "🥕", "🌽", "🍉", "🍌", "🍓", "🍕", "🍔", "🍟", "🍜", "🥟", "🍰"}},
	{"爱与友好", []string{"❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💖", "🥰", "😍", "😘", "😇", "😊", "☺️", "😌", "😋", "🫶", "🌹"}},
}
var allowedEmoji = func() map[string]bool {
	m := map[string]bool{}
	for _, g := range emojiGroups {
		for _, e := range g.Emojis {
			m[e] = true
		}
	}
	return m
}()

func (r *room) sendReaction(v reaction) {
	for ch := range r.reactions {
		select {
		case ch <- v:
		default:
		}
	}
}
