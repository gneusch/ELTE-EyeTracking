import { EyeTracker } from '../dist/index.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const btnCalibrate = document.getElementById('btn-calibrate');
const btnObserve   = document.getElementById('btn-observe');
const btnStop      = document.getElementById('btn-stop');
const btnPointer   = document.getElementById('btn-pointer');
const btnStats     = document.getElementById('btn-stats');
const btnReset     = document.getElementById('btn-reset');
const eventLog     = document.getElementById('event-log');
const statsBody    = document.getElementById('stats-body');
const canvas       = document.getElementById('detection-canvas');
const btnExportAll = document.getElementById('btn-export-all');
const fullEventHistory = [];

// ── State ─────────────────────────────────────────────────────────────────
const tracker = new EyeTracker();
let pointerVisible = true;
let statsEnabled   = true;
let statsInterval  = null;

// Targets: all cards by CSS selector
const TARGET_SELECTOR = '.card, .overlap-wrapper, .overlap-front';

// ── Detection range canvas ────────────────────────────────────────────────
function drawDetectionRange() {
  const ctx = canvas.getContext('2d');
  const W = canvas.width  = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;

  ctx.clearRect(0, 0, W, H);

  // Outer glow
  const cx = W / 2, cy = H / 2;
  const rx = W * 0.42, ry = H * 0.38;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0,   'rgba(74, 144, 226, 0.12)');
  grad.addColorStop(0.7, 'rgba(74, 144, 226, 0.06)');
  grad.addColorStop(1,   'rgba(74, 144, 226, 0)');

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Border ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(74, 144, 226, 0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 9 calibration points
  const margin = 0.1;
  const positions = [];
  for (const ry2 of [margin, 0.5, 1 - margin]) {
    for (const rx2 of [margin, 0.5, 1 - margin]) {
      positions.push({ x: rx2 * W, y: ry2 * H });
    }
  }
  for (const p of positions) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(74, 144, 226, 0.7)';
    ctx.fill();
  }

  // Label
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#7f8c8d';
  ctx.textAlign = 'center';
  ctx.fillText('Confident gaze detection zone', cx, H - 12);
}

// ── Event log helpers ─────────────────────────────────────────────────────
function logEvent(type, text) {
  const now = new Date();
  
  fullEventHistory.push({
    localTime: now.toLocaleTimeString(),
    isoTime: now.toISOString(),
    type: type,
    message: text
  });

  const li = document.createElement('li');
  li.className = type;
  li.textContent = `${now.toLocaleTimeString()} — ${text}`;
  if (eventLog.firstChild?.style?.color === 'rgb(170, 170, 170)') {
    eventLog.innerHTML = '';
  }
  eventLog.prepend(li);
  // Keep only last 20 entries
  while (eventLog.children.length > 20) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

// ── Stats table ───────────────────────────────────────────────────────────
function refreshStats() {
  const items = tracker.loadStats();
  if (items.length === 0) {
    statsBody.innerHTML = '<tr><td colspan="2" style="color:#aaa">No data yet</td></tr>';
    return;
  }
  statsBody.innerHTML = items
    .sort((a, b) => b.dwellMs - a.dwellMs)
    .map(item => {
      const el = document.querySelector(`[data-eye-id="${item.elementId}"]`);
      const label = el?.dataset.label ?? item.elementId;
      const secs = (item.dwellMs / 1000).toFixed(1);
      return `<tr><td>${label}</td><td>${secs}s</td></tr>`;
    })
    .join('');
}

// ── Card gaze highlight ───────────────────────────────────────────────────
tracker.on('lookat', ({ element }) => {
  element.classList.add('is-gazed');
  logEvent('lookat', `lookat → ${element.dataset.label ?? element.id}`);
});

tracker.on('lookaway', ({ element }) => {
  element.classList.remove('is-gazed');
  logEvent('lookaway', `lookaway ← ${element.dataset.label ?? element.id}`);
});

tracker.on('currentElementChanged', ({ element }) => {
  const label = element ? (element.dataset.label ?? element.id) : 'none';
  logEvent('changed', `current → ${label}`);
});

// ── Button wiring ─────────────────────────────────────────────────────────
btnCalibrate.addEventListener('click', async () => {
  btnCalibrate.disabled = true;
  btnCalibrate.textContent = 'Calibrating…';
  try {
    await tracker.calibrate();
    logEvent('changed', 'Calibration complete ✓');
    btnObserve.disabled = false;
  } catch (err) {
    logEvent('lookaway', `Calibration failed: ${err.message}`);
  } finally {
    btnCalibrate.disabled = false;
    btnCalibrate.textContent = 'Recalibrate';
  }
});

btnObserve.addEventListener('click', async () => {
  btnObserve.disabled = true;
  btnObserve.textContent = 'Starting…';
  try {
    await tracker.observe(TARGET_SELECTOR, 20);
    btnNextSet.style.display = 'inline-block';
    btnNextSet.disabled = false;
    statsInterval = setInterval(refreshStats, 1000);
    btnStop.disabled    = false;
    btnPointer.disabled = false;
    btnStats.disabled   = false;
    btnReset.disabled   = false;
    logEvent('changed', 'Observation started');
  } catch (err) {
    logEvent('lookaway', `Observation failed: ${err.message}`);
    btnObserve.disabled = false;
  } finally {
    btnObserve.textContent = 'Start Observation';
  }
});

btnStop.addEventListener('click', async () => {
  await tracker.stop();
  btnNextSet.disabled = true;
  clearInterval(statsInterval);
  refreshStats();
  document.querySelectorAll('.card, .overlap-wrapper').forEach(el => el.classList.remove('is-gazed'));
  btnObserve.disabled = false;
  btnStop.disabled    = true;
  btnPointer.disabled = true;
  btnStats.disabled   = true;
  logEvent('changed', 'Observation stopped — camera released');
});

btnPointer.addEventListener('click', () => {
  pointerVisible = !pointerVisible;
  tracker.setPointerVisible(pointerVisible);
  btnPointer.textContent = pointerVisible ? 'Hide Pointer' : 'Show Pointer';
});

btnStats.addEventListener('click', () => {
  statsEnabled = !statsEnabled;
  tracker.setStatsEnabled(statsEnabled);
  btnStats.textContent = statsEnabled ? 'Disable Stats' : 'Enable Stats';
  logEvent('changed', `Stats collection ${statsEnabled ? 'enabled' : 'disabled'}`);
});

btnReset.addEventListener('click', () => {
  tracker.resetStats();
  refreshStats();
  logEvent('changed', 'Stats reset');
});

btnExportAll.addEventListener('click', () => {
  const stats = tracker.loadStats();

  if (fullEventHistory.length === 0 && stats.length === 0) {
    alert('No data available for export!');
    return;
  }

  const csvLines = [];

  // ── 1. SECTION: AGGREGATED DWELL-TIME STATISTICS ──
  csvLines.push(['=== AGGREGATED DWELL-TIME STATISTICS ===']);
  csvLines.push(['Element / Image', 'Dwell Time (s)', 'Dwell Time (ms)']);

  if (stats.length === 0) {
    csvLines.push(['No data', '0.00', '0']);
  } else {
    stats
      .sort((a, b) => b.dwellMs - a.dwellMs)
      .forEach(item => {
        const el = document.querySelector(`[data-eye-id="${item.elementId}"]`);
        const label = el?.dataset.label ?? item.elementId;
        const secs = (item.dwellMs / 1000).toFixed(2);
        csvLines.push([`"${label.replace(/"/g, '""')}"`, secs, item.dwellMs]);
      });
  }

  csvLines.push([]);
  csvLines.push([]);

  // ── 2. SECTION: CHRONOLOGICAL EVENT LOG ──  
  csvLines.push(['=== DETAILED CHRONOLOGICAL EVENT LOG ===']);
  csvLines.push(['Local Time', 'ISO Timestamp', 'Event Type', 'Details']);

  fullEventHistory.forEach(event => {
    csvLines.push([
      `"${event.localTime}"`,
      `"${event.isoTime}"`,
      `"${event.type}"`,
      `"${event.message.replace(/"/g, '""')}"`
    ]);
  });

  // Prepend UTF-8 BOM (\uFEFF) for proper special character handling in Excel  
  const csvContent = '\uFEFF' + csvLines.map(row => row.join(';')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement('a');
  const fileTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadLink.href = url;
  downloadLink.download = `eyetracking_results_${fileTimestamp}.csv`;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
});

// ── Init ──────────────────────────────────────────────────────────────────
drawDetectionRange();
window.addEventListener('resize', drawDetectionRange);

// ── Load next set of pictures ──────────────────────────────────────────────
let currentRound = 1;
const btnNextSet = document.getElementById('btn-next-set');
const roundIndicator = document.getElementById('round-indicator');

const cardSlots = [
  { card: document.getElementById('card-a'), img: document.getElementById('img-a'), suffix: 'a' },
  { card: document.getElementById('card-b'), img: document.getElementById('img-b'), suffix: 'b' },
  { card: document.getElementById('card-c'), img: document.getElementById('img-c'), suffix: 'c' },
  { card: document.getElementById('card-d'), img: document.getElementById('img-d'), suffix: 'd' }
];

async function checkSetExists(roundNum) {
  try {
    const res = await fetch(`images/${roundNum}a.jpg`, { method: 'HEAD' });
    return res.ok;
  } catch (err) {
    return false;
  }
}

function applyRound(roundNum) {
  cardSlots.forEach(slot => {
    const label = `${roundNum}${slot.suffix}`;
    slot.img.src = `images/${label}.jpg`;
    slot.card.dataset.label = `Picture ${label.toUpperCase()}`;
    
    slot.card.dataset.eyeId = `eye-img-${label}`;
  });

  roundIndicator.textContent = `Picture Set: ${roundNum}. round`;
  logEvent('changed', `--- ${roundNum}. PICTURE SET LOADED ---`);
}

applyRound(1);

btnNextSet.addEventListener('click', async () => {
  btnNextSet.disabled = true;
  const nextRound = currentRound + 1;
  const exists = await checkSetExists(nextRound);

  if (exists) {
    currentRound = nextRound;
    applyRound(currentRound);
    btnNextSet.disabled = false;
  } else {
    roundIndicator.textContent = 'Experiment completed!';
    btnNextSet.style.display = 'none';
    logEvent('changed', '=== THE EXPERIMENT IS COMPLETE (NO MORE IMAGES) ===');
    
    if (btnStop && !btnStop.disabled) {
      btnStop.click();
    }
    alert('The experiment is complete! Please click the "Export Results (CSV)" button.');
  }
});