/**
 * analytics.js — the terminal analytics board, and file export/import.
 *
 * Two jobs that belong together because both are about the client database as
 * a whole rather than about one client:
 *   1. Report on it — a boot log, a summary table, and two charts
 *   2. Move it — write it to a file, and read one back
 *
 * The charts are drawn on a canvas by hand. No chart library is used, partly
 * because the assignment forbids libraries and partly because two charts of
 * this kind are about sixty lines of arithmetic each.
 *
 * Loaded after storage.js, ui.js and data.js.
 */

/* How many months of history the revenue chart covers. */
const ANALYTICS_MONTHS = 6;

/* Chart padding, in canvas pixels, leaving room for the axis labels. */
const CHART_PAD_LEFT = 64;
const CHART_PAD_BOTTOM = 34;
const CHART_PAD_TOP = 18;
const CHART_PAD_RIGHT = 16;

/* Milliseconds between boot-log lines appearing. */
const BOOT_LINE_MS = 90;

/* The version stamped into an export file. If the client shape ever changes,
   this is what tells a future importer which shape it is looking at. */
const EXPORT_VERSION = 1;

let analyticsClients = [];

/* ==================================================================
   Terminal readout
   ================================================================== */

/**
 * Print the boot log one line at a time.
 *
 * The delay is the whole point: a report that appears instantly reads as a web
 * page, whereas one that arrives line by line reads as a machine working. The
 * lines are appended with textContent on a <pre>, so client names inside them
 * are displayed rather than interpreted.
 */
let bootLogTimer = null;

function runBootLog(lines) {
  const log = document.getElementById('boot-log');

  /* Cancel a log that is still printing before starting another.
     Without this, importing a file while the first log was still running
     would leave two intervals appending to the same element and the lines
     would interleave. Clearing the text is not enough on its own — the old
     timer keeps its own position and carries on writing. */
  clearInterval(bootLogTimer);
  log.textContent = '';

  let index = 0;
  bootLogTimer = setInterval(() => {
    log.textContent += `${lines[index]}\n`;
    index += 1;
    if (index >= lines.length) clearInterval(bootLogTimer);
  }, BOOT_LINE_MS);
}

/** Pad a string to a fixed width so monospace columns line up. */
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/**
 * The summary table: one row per pipeline stage.
 *
 * Drawn with box-drawing characters into a <pre> rather than as an HTML table,
 * because the whole panel is pretending to be terminal output and a real
 * <table> would style nothing like one. The figures underneath are the same
 * ones the dashboard shows — both derive from the same client array.
 */
function renderSummary(clients) {
  const counts = countByStatus(clients);
  const total = clients.length;

  const rows = CLIENT_STATUSES.map((status) => {
    const inStage = clients.filter((client) => client.status === status);
    const value = inStage.reduce((sum, client) => sum + client.dealValue, 0);
    const share = total === 0 ? 0 : Math.round((counts[status] / total) * 100);

    /* A bar made of block characters — the cheapest possible chart, and the
       one that belongs in a terminal. */
    const bar = '█'.repeat(Math.round(share / 5)) || '·';

    return `│ ${pad(status, 10)}│${padLeft(counts[status], 6)} │${padLeft(formatMoney(value), 12)} │${padLeft(`${share}%`, 5)} │ ${pad(bar, 20)}│`;
  });

  const line = (l, m, r) => `${l}${'─'.repeat(11)}${m}${'─'.repeat(7)}${m}${'─'.repeat(13)}${m}${'─'.repeat(6)}${m}${'─'.repeat(21)}${r}`;

  document.getElementById('summary-table').textContent = [
    line('┌', '┬', '┐'),
    `│ ${pad('STAGE', 10)}│${padLeft('COUNT', 6)} │${padLeft('VALUE', 12)} │${padLeft('SHARE', 5)} │ ${pad('', 20)}│`,
    line('├', '┼', '┤'),
    ...rows,
    line('└', '┴', '┘'),
  ].join('\n');
}

/* ==================================================================
   Charts
   ================================================================== */

/** The colour to draw in, read live so the charts follow the theme. */
function chartColor(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || '#00F0FF';
}

/**
 * Shared chart frame: clear, draw the axes and the horizontal guide lines.
 *
 * Returns the plotting rectangle so each chart can position its own data
 * inside it without repeating the padding arithmetic.
 */
function beginChart(canvas, maxValue) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const width = canvas.width;
  const height = canvas.height;
  const plotLeft = CHART_PAD_LEFT;
  const plotRight = width - CHART_PAD_RIGHT;
  const plotTop = CHART_PAD_TOP;
  const plotBottom = height - CHART_PAD_BOTTOM;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';

  const grid = chartColor('--border');
  const dim = chartColor('--text-dim');

  /* Four guide lines with their values written on the left. Drawing the scale
     rather than just the bars is what makes the numbers readable. */
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const y = plotBottom - ((plotBottom - plotTop) * i) / steps;
    const value = (maxValue * i) / steps;

    ctx.strokeStyle = grid;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = dim;
    ctx.textAlign = 'right';
    ctx.fillText(formatMoney(Math.round(value)), plotLeft - 8, y);
  }

  return { ctx, plotLeft, plotRight, plotTop, plotBottom };
}

/**
 * Revenue won per month, as a filled area with a glowing line on top.
 *
 * Only deals marked Won count, because "revenue" that includes deals you have
 * not closed is not revenue. The buckets are the last six months including
 * this one, so an empty month still occupies its slot rather than being
 * silently skipped — a gap in a time series is information.
 */
function drawRevenueChart(clients) {
  const canvas = document.getElementById('chart-revenue');
  const buckets = [];
  const now = new Date();

  for (let back = ANALYTICS_MONTHS - 1; back >= 0; back -= 1) {
    const when = new Date(now.getFullYear(), now.getMonth() - back, 1);
    buckets.push({
      label: when.toLocaleDateString(undefined, { month: 'short' }),
      year: when.getFullYear(),
      month: when.getMonth(),
      total: 0,
    });
  }

  clients
    .filter((client) => client.status === 'Won')
    .forEach((client) => {
      const when = new Date(client.createdAt);
      const bucket = buckets.find(
        (b) => b.year === when.getFullYear() && b.month === when.getMonth()
      );
      if (bucket) bucket.total += client.dealValue;
    });

  /* A max of zero would divide by zero below, so an empty chart still gets a
     sensible scale to draw against. */
  const max = Math.max(...buckets.map((b) => b.total), 1000);
  const frame = beginChart(canvas, max);
  if (!frame) return;

  const { ctx, plotLeft, plotRight, plotTop, plotBottom } = frame;
  const accent = chartColor('--phosphor');
  const step = (plotRight - plotLeft) / Math.max(buckets.length - 1, 1);

  const pointAt = (index) => ({
    x: plotLeft + step * index,
    y: plotBottom - ((plotBottom - plotTop) * buckets[index].total) / max,
  });

  /* The filled area under the line. */
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  buckets.forEach((_, i) => {
    const p = pointAt(i);
    ctx.lineTo(p.x, p.y);
  });
  ctx.lineTo(plotRight, plotBottom);
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;

  /* The line itself, with a glow. shadowBlur is the canvas equivalent of the
     bloom the rest of the interface uses. */
  ctx.beginPath();
  buckets.forEach((_, i) => {
    const p = pointAt(i);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  /* A hard square at each reading, and the month underneath it. */
  ctx.textAlign = 'center';
  buckets.forEach((bucket, i) => {
    const p = pointAt(i);
    ctx.fillStyle = accent;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.fillStyle = chartColor('--text-dim');
    ctx.fillText(bucket.label, p.x, plotBottom + 16);
  });

  document.getElementById('chart-revenue-text').textContent =
    `Revenue won per month: ${buckets.map((b) => `${b.label} ${formatMoney(b.total)}`).join(', ')}.`;
}

/**
 * Total deal value sitting at each pipeline stage, as vertical bars.
 *
 * Deliberately value rather than count: five small deals and one large one are
 * very different situations, and the dashboard already shows the counts.
 */
function drawStageChart(clients) {
  const canvas = document.getElementById('chart-stage');

  const bars = CLIENT_STATUSES.map((status) => ({
    label: status,
    total: clients
      .filter((client) => client.status === status)
      .reduce((sum, client) => sum + client.dealValue, 0),
  }));

  const max = Math.max(...bars.map((b) => b.total), 1000);
  const frame = beginChart(canvas, max);
  if (!frame) return;

  const { ctx, plotLeft, plotRight, plotTop, plotBottom } = frame;
  const slot = (plotRight - plotLeft) / bars.length;
  const barWidth = Math.min(slot * 0.55, 72);

  const colors = {
    Lead: chartColor('--status-lead'),
    Contacted: chartColor('--status-contacted'),
    Won: chartColor('--status-won'),
    Lost: chartColor('--status-lost'),
  };

  ctx.textAlign = 'center';

  bars.forEach((bar, i) => {
    const x = plotLeft + slot * i + slot / 2;
    const height = ((plotBottom - plotTop) * bar.total) / max;
    const color = colors[bar.label] || chartColor('--accent');

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillRect(x - barWidth / 2, plotBottom - height, barWidth, height);
    ctx.shadowBlur = 0;

    /* A brighter cap, so each bar reads as a lit object rather than a
       flat rectangle — the same idea as the gloss on the buttons. */
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x - barWidth / 2, plotBottom - height, barWidth, 3);
    ctx.globalAlpha = 1;

    ctx.fillStyle = chartColor('--text-dim');
    ctx.fillText(bar.label, x, plotBottom + 16);
  });

  document.getElementById('chart-stage-text').textContent =
    `Total deal value by stage: ${bars.map((b) => `${b.label} ${formatMoney(b.total)}`).join(', ')}.`;
}

/* ==================================================================
   Export
   ================================================================== */

/**
 * Write the client database to a file the user keeps.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: the account. crm_users holds the password
 * in readable text, and a backup file is exactly the kind of thing people mail
 * to themselves or drop in cloud storage. Exporting it would turn a local
 * weakness the assignment forces on us into a portable one. Only the profile
 * fields that describe the person are included, never the credentials.
 *
 * The download itself is the standard trick: build a Blob, point an <a
 * download> at a temporary object URL, click it, then revoke the URL because
 * it holds the blob in memory until the page is closed otherwise.
 */
function handleExport() {
  const user = getCurrentUser();

  const payload = {
    format: '10x-crm-export',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: user ? { fullName: user.fullName, company: user.company || '' } : null,
    clients: getClients() || [],
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `10x-crm-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  document.getElementById('transfer-status').textContent =
    `> exported ${payload.clients.length} clients`;
  showToast('Export ready ✓', 'success');
}

/* ==================================================================
   Import
   ================================================================== */

/*
  A data URL is only allowed as an avatar if it is actually an image.

  This is the one place in the app where a completely untrusted document
  becomes application data. A file could name anything as an avatar, and that
  string ends up in an <img src>. Restricting it to data:image/... and https://
  means a hand-edited file cannot smuggle in a javascript: or data:text/html
  URL and have the app render it.
*/
function safeImageValue(value) {
  const text = String(value || '');
  if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(text)) return text;
  if (/^https:\/\//.test(text)) return text;
  return '';
}

/**
 * Rebuild one client from untrusted input.
 *
 * Every field is coerced to the type the app expects rather than trusted to
 * already be it. A "dealValue" that arrives as the string "abc" would poison
 * every total on the dashboard; Number() plus a finite check turns it into 0
 * instead. A missing notes array would break the detail window on open.
 *
 * Returns null for a record with no usable name, which is the one field
 * nothing else can be derived from.
 */
function sanitizeImportedClient(raw, index) {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name || '').trim();
  if (name === '') return null;

  const value = Number(raw.dealValue);

  return {
    /* Ids are reassigned rather than trusted. A file with two clients sharing
       an id would make deleting one delete both. */
    id: Date.now() + index,
    name,
    email: String(raw.email || '').trim(),
    phone: String(raw.phone || '').trim(),
    company: String(raw.company || '').trim(),
    image: safeImageValue(raw.image),
    avatar: safeImageValue(raw.avatar),
    status: CLIENT_STATUSES.includes(raw.status) ? raw.status : DEFAULT_STATUS,
    dealValue: Number.isFinite(value) && value > 0 ? value : 0,
    notes: Array.isArray(raw.notes)
      ? raw.notes
          .filter((note) => note && typeof note === 'object')
          .map((note) => ({
            text: String(note.text || ''),
            date: String(note.date || ''),
          }))
      : [],
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

/**
 * Read a file back in, replacing the current client list.
 *
 * Confirmed first, because it overwrites everything. This is the second of the
 * only two confirm() dialogs in the app, and for the same reason as the first:
 * the action is destructive and cannot be undone.
 */
async function handleImport(event) {
  const input = event.target;
  const file = input.files[0];
  const errorSlot = document.querySelector('[data-error-for="import-input"]');
  const status = document.getElementById('transfer-status');

  errorSlot.textContent = '';
  if (!file) return;

  try {
    const text = await file.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      /* JSON.parse throws on anything malformed, and the message it throws is
         written for a developer. The user gets a plain one. */
      errorSlot.textContent = 'That file is not valid JSON';
      return;
    }

    if (!payload || !Array.isArray(payload.clients)) {
      errorSlot.textContent = 'That file does not look like a 10X CRM export';
      return;
    }

    const cleaned = payload.clients
      .map(sanitizeImportedClient)
      .filter((client) => client !== null);

    if (cleaned.length === 0) {
      errorSlot.textContent = 'That file contains no usable clients';
      return;
    }

    const replacing = (getClients() || []).length;
    const confirmed = window.confirm(
      `Import ${cleaned.length} clients? This replaces the ${replacing} currently stored.`
    );
    if (!confirmed) return;

    if (!saveClients(cleaned)) {
      errorSlot.textContent = 'Not enough browser storage left to import that file';
      return;
    }

    const skipped = payload.clients.length - cleaned.length;
    status.textContent = `> imported ${cleaned.length} clients`
      + (skipped > 0 ? `, skipped ${skipped} unreadable` : '');

    analyticsClients = cleaned;
    renderAnalytics();
    showToast(`Imported ${cleaned.length} clients ✓`, 'success');
  } catch (error) {
    errorSlot.textContent = 'Could not read that file';
  } finally {
    /* Reset so re-picking the same file fires another change event. */
    input.value = '';
  }
}

/* ==================================================================
   Start-up
   ================================================================== */

function renderAnalytics() {
  const clients = analyticsClients;
  const won = clients.filter((client) => client.status === 'Won');
  const revenue = won.reduce((sum, client) => sum + client.dealValue, 0);
  const pipeline = clients
    .filter((client) => client.status === 'Lead' || client.status === 'Contacted')
    .reduce((sum, client) => sum + client.dealValue, 0);

  runBootLog([
    '> 10X CRM ANALYTICS v1.0',
    '> mounting crm_clients ... OK',
    `> ${clients.length} records loaded`,
    `> ${won.length} closed / ${formatMoney(revenue)} realised`,
    `> ${formatMoney(pipeline)} still open`,
    '> ready.',
  ]);

  renderSummary(clients);
  drawRevenueChart(clients);
  drawStageChart(clients);
}

async function initAnalytics() {
  document.getElementById('export-btn').addEventListener('click', handleExport);
  document.getElementById('import-input').addEventListener('change', handleImport);

  try {
    /* The same loadClients() the dashboard and the clients page use, so all
       three always report on exactly the same data. */
    analyticsClients = await loadClients();
  } catch (error) {
    analyticsClients = [];
    document.getElementById('boot-log').textContent =
      '> mounting crm_clients ... FAILED\n> could not reach the API and nothing is cached.';
    return;
  }

  renderAnalytics();

  /* Redraw on theme change: the charts read their colours at draw time, so a
     canvas drawn in dark mode keeps its dark-mode colours until it is drawn
     again. CSS repaints itself; a canvas does not. */
  const themeButton = document.querySelector('[data-theme-toggle]');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      drawRevenueChart(analyticsClients);
      drawStageChart(analyticsClients);
    });
  }
}

/* Do nothing if the auth guard is already redirecting — see js/app.js. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', initAnalytics);
}
