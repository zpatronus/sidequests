const colorScheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = colorScheme.matches ? 'dark' : 'light';
}
applyTheme();
colorScheme.addEventListener('change', applyTheme);

const interval = 5000;
const statusMessage = document.getElementById('status');
let lastSample;
let failing = false;

function duration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return Math.floor(seconds) + 's';
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return [days && days + 'd', hours % 24 && hours % 24 + 'h', minutes % 60 + 'm'].filter(Boolean).join(' ');
}

function dataSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index++;
  }
  return bytes.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
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
  databaseBytes: dataSize,
  receiveRate: bytes => dataSize(bytes) + '/s',
  sendRate: bytes => dataSize(bytes) + '/s',
  received: dataSize,
  sent: dataSize,
};

const updated = document.getElementById('updated');

function renderInterfaces(interfaces, addressesIncluded) {
  const target = document.getElementById('interfaces');
  if (!interfaces?.length) {
    const message = document.createElement('p');
    message.textContent = 'Interface details unavailable';
    target.replaceChildren(message);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'interface-grid';
  const number = new Intl.NumberFormat();
  for (const iface of interfaces) {
    const card = document.createElement('article');
    card.className = 'interface';
    const title = document.createElement('h3');
    title.textContent = iface.name;
    const details = document.createElement('dl');
    details.className = 'identity';
    const add = (label, value, className) => {
      const item = document.createElement('div');
      if (className) item.className = className;
      const term = document.createElement('dt');
      const data = document.createElement('dd');
      term.textContent = label;
      data.textContent = value ?? 'Unavailable';
      item.append(term, data);
      details.append(item);
    };
    add('State', iface.state);
    add('MTU', iface.mtu);
    add('Link speed', iface.speedMbps == null ? null : iface.speedMbps + ' Mb/s');
    if (addressesIncluded) {
      add('MAC address', iface.mac || null);
      add('IP addresses', iface.addresses?.join(' · ') || null, 'addresses');
    }
    if (iface.traffic) {
      add('Received / sent', dataSize(iface.traffic.received) + ' / ' + dataSize(iface.traffic.sent));
      for (const field of ['Packets', 'Errors', 'Drops']) {
        const received = iface.traffic['receive' + field];
        const sent = iface.traffic['send' + field];
        add(field + ' received / sent', number.format(received) + ' / ' + number.format(sent));
      }
    }
    card.append(title, details);
    grid.append(card);
  }
  target.replaceChildren(grid);
}

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
    const readings = {
      ...sample,
      databaseBytes: sample.database?.bytes,
      os: sample.osRelease || sample.os,
      receiveRate: sample.network?.rate?.received,
      sendRate: sample.network?.rate?.sent,
      received: sample.network?.totals?.received,
      sent: sample.network?.totals?.sent,
    };
    for (const [id, format] of Object.entries(formats)) {
      const value = readings[id];
      document.getElementById(id).textContent = value == null || value === '' ? 'Unavailable' : format(value);
    }
    document.getElementById('database').hidden = sample.database == null;
    renderInterfaces(sample.interfaces, sample.addressesIncluded);
    lastSample = timestamp;
    if (!updated.textContent || failing) statusMessage.textContent = 'Refreshes every 5 seconds';
    updated.dateTime = timestamp.toISOString();
    updated.textContent = 'Last updated ' + timestamp.toLocaleTimeString();
    statusMessage.dataset.state = 'live';
    failing = false;
  } catch {
    if (!failing) {
      statusMessage.textContent = lastSample ? 'Refresh failed. Showing the last reading and retrying.' : 'Metrics unavailable. Retrying…';
    }
    statusMessage.dataset.state = 'retrying';
    failing = true;
  } finally {
    clearTimeout(timeout);
    setTimeout(refresh, Math.max(0, interval - (performance.now() - started)));
  }
}

refresh();
