//go:build !linux

package dashboard

import "time"

func processCPUTime() *time.Duration { return nil }
