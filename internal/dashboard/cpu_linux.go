package dashboard

import (
	"syscall"
	"time"
)

func processCPUTime() *time.Duration {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return nil
	}
	value := time.Duration(usage.Utime.Nano()) + time.Duration(usage.Stime.Nano())
	return &value
}
