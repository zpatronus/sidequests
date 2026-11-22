package dashboard

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type networkCounters struct {
	Received uint64 `json:"received"`
	Sent     uint64 `json:"sent"`
}

type networkRate struct {
	Received float64 `json:"received"`
	Sent     float64 `json:"sent"`
}

type networkSample struct {
	Totals networkCounters `json:"totals"`
	Rate   *networkRate    `json:"rate"`
}

func networkInterfaces(path string) map[string]networkCounters {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	interfaces := make(map[string]networkCounters)
	for _, line := range strings.Split(string(data), "\n") {
		name, values, ok := strings.Cut(line, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "" || name == "lo" {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 16 {
			return nil
		}
		received, receiveErr := strconv.ParseUint(fields[0], 10, 64)
		sent, sendErr := strconv.ParseUint(fields[8], 10, 64)
		if receiveErr != nil || sendErr != nil {
			return nil
		}
		interfaces[name] = networkCounters{Received: received, Sent: sent}
	}
	return interfaces
}

func measureNetwork(previous, current map[string]networkCounters, elapsed time.Duration) *networkSample {
	if len(current) == 0 {
		return nil
	}
	var result networkSample
	var delta networkCounters
	rateAvailable := elapsed > 0 && len(previous) == len(current)
	for name, counters := range current {
		result.Totals.Received += counters.Received
		result.Totals.Sent += counters.Sent
		old, ok := previous[name]
		if !ok || counters.Received < old.Received || counters.Sent < old.Sent {
			rateAvailable = false
			continue
		}
		delta.Received += counters.Received - old.Received
		delta.Sent += counters.Sent - old.Sent
	}
	if rateAvailable {
		result.Rate = &networkRate{
			Received: float64(delta.Received) / elapsed.Seconds(),
			Sent:     float64(delta.Sent) / elapsed.Seconds(),
		}
	}
	return &result
}
