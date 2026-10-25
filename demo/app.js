import { EyeTracker } from '../dist/index.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const btnCalibrate = document.getElementById('btn-calibrate');
const btnObserve   = document.getElementById('btn-observe');
const btnStop      = document.getElementById('btn-stop');
const btnPointer   = document.getElementById('btn-pointer');
const btnStats     = document.getElementById('btn-stats');
const btnReset     = document.getElementById('btn-reset');
const btnEventLog  = document.getElementById('btn-event-log');
const eventLogMenu = document.getElementById('event-log-menu');
const eventLogPanel = document.getElementById('event-log-panel');
const eventLog     = document.getElementById('event-log');
const statsBody    = document.getElementById('stats-body');
const canvas       = document.getElementById('detection-canvas');
const cardsGrid    = document.querySelector('.cards-grid');
const targetsArea  = document.querySelector('.targets-area');
const modeSelect   = document.getElementById('observation-mode');
const btnNextSet   = document.getElementById('btn-next-set');
const roundIndicator = document.getElementById('round-indicator');
const btnDetectionToggle = document.getElementById('btn-detection-toggle');
const detectionContent = document.getElementById('detection-content');
const btnExportAll = document.getElementById('btn-export-all');
const fullEventHistory = [];

const cardSlots = [
  { card: document.getElementById('card-a'), img: document.getElementById('img-a'), suffix: 'a' },
  { card: document.getElementById('card-b'), img: document.getElementById('img-b'), suffix: 'b' },
  { card: document.getElementById('card-c'), img: document.getElementById('img-c'), suffix: 'c' },
  { card: document.getElementById('card-d'), img: document.getElementById('img-d'), suffix: 'd' }
];
const observationModes = {
  two: { directory: 'images_v2', suffixes: ['a', 'b'], displayName: 'Two-picture' },
  four: { directory: 'images', suffixes: ['a', 'b', 'c', 'd'], displayName: 'Four-picture' }
};

// ── State ─────────────────────────────────────────────────────────────────
const tracker = new EyeTracker();
let pointerVisible = true;
let statsEnabled   = true;
let statsInterval  = null;
let currentMode = modeSelect.value;
let currentRound = 1;
let stimulusReady = false;
let calibrationComplete = false;

function getActiveCardSlots(mode = currentMode) {
  const activeSuffixes = observationModes[mode].suffixes;
  return cardSlots.filter(slot => activeSuffixes.includes(slot.suffix));
}

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

function fitCardsToCalibrationZone() {
  const gridTop = cardsGrid.getBoundingClientRect().top;
  const gridHeight = currentMode === 'two'
    ? window.innerHeight - 2 * gridTop
    : window.innerHeight * 0.9 - gridTop;
  cardsGrid.style.height = `${Math.max(0, gridHeight)}px`;
}

btnDetectionToggle.addEventListener('click', () => {
  const isExpanded = btnDetectionToggle.getAttribute('aria-expanded') !== 'true';
  btnDetectionToggle.setAttribute('aria-expanded', String(isExpanded));
  detectionContent.hidden = !isExpanded;
  if (isExpanded) drawDetectionRange();
});

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
function getStatsLabel(elementId) {
  const activeCard = cardSlots.find(slot => slot.card.dataset.eyeId === elementId);
  if (activeCard) return activeCard.card.dataset.label;

  const modeMatch = /^eye-img-(two|four)-(\d+[a-d])$/.exec(elementId);
  if (modeMatch) {
    const modeName = observationModes[modeMatch[1]].displayName;
    return `${modeName} — Picture ${modeMatch[2].toUpperCase()}`;
  }

  const legacyMatch = /^eye-img-(\d+[a-d])$/.exec(elementId);
  if (legacyMatch) return `Four-picture — Picture ${legacyMatch[1].toUpperCase()}`;
  return elementId;
}

function refreshStats() {
  const items = tracker.loadStats();
  if (items.length === 0) {
    statsBody.innerHTML = '<tr><td colspan="2" style="color:#aaa">No data yet</td></tr>';
    return;
  }
  statsBody.innerHTML = items
    .sort((a, b) => b.dwellMs - a.dwellMs)
    .map(item => {
      const label = getStatsLabel(item.elementId);
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
function closeEventLog() {
  eventLogMenu.classList.remove('is-open');
  btnEventLog.setAttribute('aria-expanded', 'false');
  eventLogPanel.setAttribute('aria-hidden', 'true');
}

btnEventLog.addEventListener('click', () => {
  const isOpen = eventLogMenu.classList.toggle('is-open');
  btnEventLog.setAttribute('aria-expanded', String(isOpen));
  eventLogPanel.setAttribute('aria-hidden', String(!isOpen));
});

eventLogMenu.addEventListener('mouseleave', closeEventLog);
eventLogMenu.addEventListener('focusout', event => {
  if (!eventLogMenu.contains(event.relatedTarget)) {
    closeEventLog();
  }
});
eventLogMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeEventLog();
    btnEventLog.focus();
  }
});

btnCalibrate.addEventListener('click', async () => {
  btnCalibrate.disabled = true;
  btnCalibrate.textContent = 'Calibrating…';
  try {
    await tracker.calibrate();
    calibrationComplete = true;
    logEvent('changed', 'Calibration complete ✓');
    btnObserve.disabled = !stimulusReady;
  } catch (err) {
    logEvent('lookaway', `Calibration failed: ${err.message}`);
  } finally {
    btnCalibrate.disabled = false;
    btnCalibrate.textContent = 'Recalibrate';
  }
});

btnObserve.addEventListener('click', async () => {
  btnObserve.disabled = true;
  modeSelect.disabled = true;
  btnObserve.textContent = 'Starting…';
  try {
    await tracker.observe(getActiveCardSlots().map(slot => slot.card), 20);
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
    modeSelect.disabled = false;
  } finally {
    btnObserve.textContent = 'Start Observation';
  }
});

btnStop.addEventListener('click', async () => {
  await tracker.stop();
  btnNextSet.disabled = true;
  btnNextSet.style.display = 'none';
  clearInterval(statsInterval);
  refreshStats();
  cardSlots.forEach(slot => slot.card.classList.remove('is-gazed'));
  modeSelect.disabled = false;
  btnObserve.disabled = !calibrationComplete || !stimulusReady;
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
        const label = getStatsLabel(item.elementId);
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
fitCardsToCalibrationZone();
window.addEventListener('resize', drawDetectionRange);
window.addEventListener('resize', () => {
  requestAnimationFrame(() => requestAnimationFrame(fitCardsToCalibrationZone));
});

// ── Load picture sets ─────────────────────────────────────────────────────
async function checkRoundAvailability(roundNum, mode) {
  const config = observationModes[mode];
  const results = await Promise.all(config.suffixes.map(async suffix => {
    const url = `${config.directory}/${roundNum}${suffix}.jpg`;
    let response;
    try {
      response = await fetch(url, { method: 'HEAD' });
    } catch (err) {
      throw new Error(`Could not check ${url}: ${err.message}`);
    }

    if (response.status === 404 || response.status === 410) {
      return { url, available: false };
    }
    if (!response.ok) {
      throw new Error(`Could not check ${url} (HTTP ${response.status}).`);
    }
    return { url, available: true };
  }));

  const missing = results.filter(result => !result.available);
  if (missing.length === results.length) return null;
  if (missing.length > 0) {
    throw new Error(`Incomplete picture set ${roundNum}; missing ${missing.map(item => item.url).join(', ')}.`);
  }
  return results.map(result => result.url);
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Could not load image ${url}.`));
    image.src = url;
  });
}

async function loadRound(roundNum, mode) {
  const urls = await checkRoundAvailability(roundNum, mode);
  if (!urls) return false;

  await Promise.all(urls.map(preloadImage));

  const config = observationModes[mode];
  const activeSuffixes = new Set(config.suffixes);
  const activeSlots = getActiveCardSlots(mode);
  activeSlots.forEach((slot, index) => {
    const pictureId = `${roundNum}${slot.suffix}`;
    const label = `${config.displayName} — Picture ${pictureId.toUpperCase()}`;
    slot.img.src = urls[index];
    slot.img.alt = `Picture ${pictureId.toUpperCase()}`;
    slot.card.dataset.label = label;
    slot.card.dataset.eyeId = `eye-img-${mode}-${pictureId}`;
  });

  cardSlots.forEach(slot => {
    slot.card.hidden = !activeSuffixes.has(slot.suffix);
    slot.card.classList.remove('is-gazed');
  });
  cardsGrid.classList.toggle('two-picture-mode', mode === 'two');
  targetsArea.classList.toggle('two-picture-mode', mode === 'two');
  modeSelect.value = mode;
  currentMode = mode;
  currentRound = roundNum;
  roundIndicator.textContent = `${config.displayName} mode — Picture Set: ${roundNum}`;
  fitCardsToCalibrationZone();
  logEvent('changed', `--- ${config.displayName.toUpperCase()} PICTURE SET ${roundNum} LOADED ---`);
  return true;
}

function reportRoundLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  logEvent('lookaway', `Picture set loading failed: ${message}`);
  alert(`Picture set could not be loaded. ${message}`);
}

modeSelect.addEventListener('change', async () => {
  const selectedMode = modeSelect.value;
  modeSelect.disabled = true;
  btnObserve.disabled = true;
  btnNextSet.disabled = true;
  try {
    const loaded = await loadRound(1, selectedMode);
    if (!loaded) {
      throw new Error(`The first picture set is missing from ${observationModes[selectedMode].directory}/.`);
    }
    stimulusReady = true;
    btnObserve.disabled = !calibrationComplete;
    btnNextSet.style.display = 'none';
    btnNextSet.disabled = true;
  } catch (err) {
    modeSelect.value = currentMode;
    reportRoundLoadError(err);
  } finally {
    modeSelect.disabled = !btnStop.disabled;
    btnObserve.disabled = !calibrationComplete || !stimulusReady;
    btnNextSet.disabled = true;
  }
});

btnNextSet.addEventListener('click', async () => {
  btnNextSet.disabled = true;
  const nextRound = currentRound + 1;
  try {
    const loaded = await loadRound(nextRound, currentMode);
    if (loaded) return;

    const config = observationModes[currentMode];
    roundIndicator.textContent = `${config.displayName} mode — Experiment completed!`;
    btnNextSet.style.display = 'none';
    logEvent('changed', `=== ${config.displayName.toUpperCase()} EXPERIMENT COMPLETE (NO MORE IMAGES) ===`);
    if (!btnStop.disabled) btnStop.click();
    alert('The experiment is complete! Please click the "Export Results (CSV)" button.');
  } catch (err) {
    reportRoundLoadError(err);
  } finally {
    if (btnNextSet.style.display !== 'none' && !btnStop.disabled) {
      btnNextSet.disabled = false;
    }
  }
});

async function initializeStimuli() {
  modeSelect.disabled = true;
  try {
    const loaded = await loadRound(1, currentMode);
    if (!loaded) {
      throw new Error(`The first picture set is missing from ${observationModes[currentMode].directory}/.`);
    }
    stimulusReady = true;
    btnObserve.disabled = !calibrationComplete;
  } catch (err) {
    reportRoundLoadError(err);
  } finally {
    modeSelect.disabled = false;
  }
}

initializeStimuli();