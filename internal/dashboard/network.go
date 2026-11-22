package dashboard

import (
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type networkCounters struct {
	Received       uint64 `json:"received"`
	Sent           uint64 `json:"sent"`
	ReceivePackets uint64 `json:"receivePackets"`
	SendPackets    uint64 `json:"sendPackets"`
	ReceiveErrors  uint64 `json:"receiveErrors"`
	SendErrors     uint64 `json:"sendErrors"`
	ReceiveDrops   uint64 `json:"receiveDrops"`
	SendDrops      uint64 `json:"sendDrops"`
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
		name, columns, ok := strings.Cut(line, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "" || name == "lo" {
			continue
		}
		fields := strings.Fields(columns)
		if len(fields) < 16 {
			return nil
		}
		var values [8]uint64
		for i, column := range [...]int{0, 8, 1, 9, 2, 10, 3, 11} {
			value, err := strconv.ParseUint(fields[column], 10, 64)
			if err != nil {
				return nil
			}
			values[i] = value
		}
		interfaces[name] = networkCounters{
			Received: values[0], Sent: values[1], ReceivePackets: values[2], SendPackets: values[3],
			ReceiveErrors: values[4], SendErrors: values[5], ReceiveDrops: values[6], SendDrops: values[7],
		}
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

type interfaceDetails struct {
	Name      string           `json:"name"`
	State     string           `json:"state"`
	MTU       int              `json:"mtu"`
	SpeedMbps *uint64          `json:"speedMbps"`
	Addresses []string         `json:"addresses,omitempty"`
	MAC       string           `json:"mac,omitempty"`
	Traffic   *networkCounters `json:"traffic"`
}

func describeInterfaces(counters map[string]networkCounters, private bool) []interfaceDetails {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	result := make([]interfaceDetails, 0, len(interfaces))
	for _, iface := range interfaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		details := interfaceDetails{Name: iface.Name, MTU: iface.MTU, State: "Down"}
		if iface.Flags&net.FlagUp != 0 {
			details.State = "Up"
		}
		if counters, ok := counters[iface.Name]; ok {
			details.Traffic = &counters
		}
		if speed, err := os.ReadFile(filepath.Join("/sys/class/net", iface.Name, "speed")); err == nil {
			if value, err := strconv.ParseUint(strings.TrimSpace(string(speed)), 10, 64); err == nil && value > 0 {
				details.SpeedMbps = &value
			}
		}
		if private {
			details.MAC = iface.HardwareAddr.String()
			addresses, _ := iface.Addrs()
			for _, address := range addresses {
				details.Addresses = append(details.Addresses, address.String())
			}
			sort.Strings(details.Addresses)
		}
		result = append(result, details)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	if !private {
		for index := range result {
			// Predictable interface names can contain the MAC address.
			result[index].Name = "Interface " + strconv.Itoa(index+1)
		}
	}
	return result
}
