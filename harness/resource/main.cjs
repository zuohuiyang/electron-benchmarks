const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const emit = (event, details = {}) => process.stdout.write('@@ELECTRON_BENCH@@' + JSON.stringify({ event, ...details }) + '\n');
app.setPath('userData', process.env.RUNTIME_BENCH_PROFILE);
let window;
let requests = 0;
const sample = () => {
  if (!window.isVisible() || window.isMinimized()) throw Error('Resource window is hidden or minimized');
  const metrics = app.getAppMetrics();
  if (!metrics.length || requests) throw Error('Missing process metrics or unexpected network request');
  return { timeNs: process.hrtime.bigint().toString(), processes: metrics, versions: process.versions };
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => { requests++; callback({ cancel: true }); });
  window = new BrowserWindow({ width: 1080, height: 760, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(path.join(__dirname, 'index.html'));
  await new Promise(resolve => setTimeout(resolve, Number(process.env.BENCH_SETTLE_MS)));
  let previous = sample(); // Prime CPU intervals; the first reading is not reported as a sample.
  emit('resource-ready', { processes: previous.processes.map(p => ({ pid: p.pid, creationTime: p.creationTime })) });
  const start = process.hrtime.bigint(); const observations = [];
  while (Number(process.hrtime.bigint() - start) / 1e6 < Number(process.env.BENCH_OBSERVE_MS)) {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.BENCH_SAMPLE_MS)));
    const current = sample();
    const identity = value => value.processes.map(p => `${p.pid}:${p.creationTime}`).sort().join(',');
    if (identity(previous) !== identity(current)) throw Error('Process group changed during the observation period');
    observations.push({ ...current, intervalMs: Number(BigInt(current.timeNs) - BigInt(previous.timeNs)) / 1e6 });
    previous = current;
  }
  emit('resources', { observations, visible: window.isVisible(), versions: process.versions });
  // Keep the process alive while the parent checks actual priority after the observation period.
  setTimeout(() => app.quit(), 1200);
}).catch(error => { emit('error', { message: error.stack }); app.exit(1); });
app.on('window-all-closed', () => app.exit(1));
