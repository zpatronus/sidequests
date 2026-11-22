const interval = 5000;
const status = document.getElementById('status');
let lastSample;
let failing = false;

function duration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return Math.floor(seconds) + 's';
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return [days && days + 'd', hours % 24 && hours % 24 + 'h', minutes % 60 + 'm'].filter(Boolean).join(' ');
}

const formats = {
  cpuModel: String,
  architecture: String,
  os: String,
  kernel: String,
  cpus: String,
  load: values => values.map(value => value.toFixed(2)).join(' / '),
  memory: ({availableKiB, totalKiB}) => [availableKiB, totalKiB]
    .map(value => (value / 1048576).toFixed(2) + ' GiB').join(' / '),
  systemUptime: duration,
  processUptime: duration,
  processCPU: percent => percent.toFixed(1) + '%',
  residentKiB: kib => (kib / 1024).toFixed(1) + ' MiB',
  goVersion: String,
  heapBytes: bytes => (bytes / 1048576).toFixed(1) + ' MiB',
  goroutines: String,
};

const updated = document.createElement('span');
status.after(updated);
updated.setAttribute('aria-live', 'off');

async function refresh() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const started = performance.now();
  try {
    const response = await fetch('/dashboard/metrics', {signal: controller.signal, cache: 'no-store'});
    if (!response.ok) throw new Error('Metrics unavailable');
    const sample = await response.json();
    const timestamp = new Date(sample.sampledAt);
    if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid sample');
    for (const [id, format] of Object.entries(formats)) {
      const value = id === 'os' ? sample.osRelease || sample.os : sample[id];
      document.getElementById(id).textContent = value == null || value === '' ? 'Unavailable' : format(value);
    }
    lastSample = timestamp;
    if (!updated.textContent || failing) status.textContent = 'Refreshes every 5 seconds';
    updated.textContent = 'Last updated ' + timestamp.toLocaleTimeString();
    failing = false;
  } catch {
    if (!failing) {
      status.textContent = lastSample ? 'Refresh failed. Showing the last reading and retrying.' : 'Metrics unavailable. Retrying…';
    }
    failing = true;
  } finally {
    clearTimeout(timeout);
    setTimeout(refresh, Math.max(0, interval - (performance.now() - started)));
  }
}

refresh();
