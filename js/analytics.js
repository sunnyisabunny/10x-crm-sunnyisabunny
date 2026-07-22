/**
 * analytics.js — the diagnostic board, and file export/import.
 *
 * WHAT THIS PAGE IS FOR, AND WHY IT IS NOT THE DASHBOARD
 *
 * The first version of this page was a dashboard in different clothes: it
 * reported the same counts and the same stage breakdown, dressed as a
 * terminal. That is a fair criticism and it was right.
 *
 * The dashboard answers "what is happening?" — how many clients, how much
 * revenue, what sits in each stage. Those are facts about the present.
 *
 * This page answers two questions the dashboard cannot:
 *   1. "What is going wrong?"  — deals that have gone quiet, deals stuck far
 *      longer than normal, revenue leaning dangerously on one account
 *   2. "Where is this heading?" — win rate, how long deals take, and what the
 *      open pipeline is really worth once the win rate is applied to it
 *
 * Every number here is derived rather than counted. Nothing on this page is a
 * total the dashboard already shows.
 *
 * Loaded after storage.js, ui.js and data.js.
 */

/* ==================================================================
   Page settings

   The thresholds and the diagnosis itself used to live here. They moved to
   data.js when RONIN started giving the same advice: two features reading
   the same client list must not each carry their own idea of what
   "neglected" means, or the assistant and this page would eventually
   disagree in front of the user. What stays here is what only this page
   uses — chart geometry and the export format.
   ================================================================== */

/* How many months the revenue chart covers. */
const ANALYTICS_MONTHS = 6;

/* Chart geometry, in canvas pixels. */
const CHART_PAD_LEFT = 64;
const CHART_PAD_BOTTOM = 34;
const CHART_PAD_TOP = 18;
const CHART_PAD_RIGHT = 16;

/* Milliseconds between scan lines appearing. */
const SCAN_LINE_MS = 80;

/* The version stamped into an export file. */
const EXPORT_VERSION = 1;

let analyticsClients = [];
/* ==================================================================
   Rendering the scan
   ================================================================== */

let scanTimer = null;

/**
 * Print the scan one line at a time.
 *
 * The previous timer is cancelled first. Without that, importing a file while
 * a scan was still printing would leave two intervals appending to the same
 * element and the lines would interleave — clearing the text is not enough,
 * because the old timer keeps its own position.
 */
function runScan(lines) {
  const log = document.getElementById('scan-log');

  clearInterval(scanTimer);
  log.textContent = '';

  let index = 0;
  scanTimer = setInterval(() => {
    log.textContent += `${lines[index]}\n`;
    index += 1;
    if (index >= lines.length) clearInterval(scanTimer);
  }, SCAN_LINE_MS);
}

function renderScan(metrics, findings) {
  const problems = findings.filter((f) => f.level === 'FAIL' || f.level === 'WARN');

  const lines = [
    '> 10X CRM DIAGNOSTIC v1.0',
    `> scanning ${metrics.total} records ...`,
    '',
    ...findings.map((f) => `[ ${pad(f.level, 4)} ] ${f.title}`),
    '',
    problems.length === 0
      ? '> no issues found. nothing needs your attention today.'
      : `> ${problems.length} issue${problems.length === 1 ? '' : 's'} require attention. detail below.`,
  ];

  runScan(lines);
}

/** Pad a string to a fixed width so the monospace columns line up. */
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * The detail behind each finding: the actual clients, named.
 *
 * Built with createElement and textContent throughout, because these are
 * client names the user typed and this page is no different from any other in
 * that respect.
 */
function renderFindings(findings) {
  const host = document.getElementById('findings');
  host.replaceChildren();

  findings
    .filter((finding) => finding.rows.length > 0)
    .forEach((finding) => {
      const panel = document.createElement('div');
      panel.className = `window finding finding--${finding.level.toLowerCase()}`;

      const bar = document.createElement('div');
      bar.className = 'window__bar';
      const title = document.createElement('span');
      title.className = 'window__title';
      title.textContent = `${finding.level}: ${finding.title}`;
      bar.append(title);

      const body = document.createElement('div');
      body.className = 'window__body stack-2';

      if (finding.hint) {
        const hint = document.createElement('p');
        hint.className = 'text-dim';
        hint.style.fontSize = 'var(--fs-sm)';
        hint.textContent = finding.hint;
        body.append(hint);
      }

      finding.rows.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'finding__row';

        const name = document.createElement('span');
        name.className = 'finding__name';
        name.textContent = row.name;

        const meta = document.createElement('span');
        meta.className = 'finding__meta mono';
        meta.textContent = row.meta;

        const value = document.createElement('span');
        value.className = 'finding__value mono';
        value.textContent = formatMoney(row.value);

        line.append(name, meta, value);
        body.append(line);
      });

      panel.append(bar, body);
      host.append(panel);
    });
}

/* ==================================================================
   Forecast readout
   ================================================================== */

function renderForecast(metrics) {
  const pct = (n) => `${Math.round(n * 100)}%`;

  const change = metrics.lastMonth === 0
    ? (metrics.thisMonth > 0 ? 'new' : 'flat')
    : `${metrics.thisMonth >= metrics.lastMonth ? '+' : ''}${Math.round(((metrics.thisMonth - metrics.lastMonth) / metrics.lastMonth) * 100)}%`;

  const rows = [
    ['win rate', metrics.rateIsMeaningful ? pct(metrics.winRate) : `${pct(metrics.winRate)} (low confidence)`],
    ['deals closed', `${metrics.won.length} won / ${metrics.lost.length} lost`],
    ['average cycle', `${metrics.cycleDays} days to close`],
    ['average deal', formatMoney(metrics.avgDeal)],
    ['', ''],
    ['realised revenue', formatMoney(metrics.wonValue)],
    ['this month', `${formatMoney(metrics.thisMonth)}  (${change} vs last month)`],
    ['', ''],
    ['open pipeline', formatMoney(metrics.openValue)],
    [`x win rate ${pct(metrics.winRate)}`, ''],
    ['EXPECTED', formatMoney(metrics.forecast)],
  ];

  document.getElementById('forecast-table').textContent = rows
    .map(([label, value]) => (label === '' ? '' : `  ${pad(label, 22)}${value}`))
    .join('\n');
}

/* ==================================================================
   Charts
   ================================================================== */

/* ------------------------------------------------------------------
   DRAWING CHARTS BY HAND

   There is no charting library here, partly because the assignment forbids
   libraries and partly because these two charts are about sixty lines of
   arithmetic each. Worth understanding, because a canvas is genuinely
   different from the rest of the DOM:

   A canvas is ONE element containing a grid of pixels. Nothing inside it is
   an element — there is no bar you can inspect, click or style, only paint on
   a surface. That has three consequences this file has to handle:

     1. Position is arithmetic. Nothing lays itself out, so every bar's x, y,
        width and height is calculated here.
     2. Nothing redraws itself. CSS repaints when the theme changes; a canvas
        keeps whatever was painted, which is why the theme toggle explicitly
        redraws these (see the bottom of the file).
     3. A screen reader sees an image with no content. That is why each chart
        writes a plain-sentence summary into a visually hidden paragraph
        beside it.

   The co-ordinate system starts at the TOP-left and y grows DOWNWARDS, which
   is upside-down from how a graph is normally described. That single fact is
   why "taller bar" is written as a SMALLER y below, and it is the most common
   thing to get wrong when reading canvas code.
   ------------------------------------------------------------------ */

/**
 * Read a colour out of the live theme.
 *
 * The colours are not hardcoded, because they have to change with the theme —
 * and because a canvas cannot use `var(--phosphor)` the way CSS can. So the
 * value is looked up from the computed styles of <body> at drawing time and
 * handed to the canvas as an ordinary colour string.
 */
function chartColor(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || '#00F0FF';
}

/**
 * The conversion funnel.
 *
 * NOT the dashboard's pipeline bar. That shows how many clients sit in each
 * stage right now; this shows the percentage lost moving BETWEEN stages, which
 * is the number that tells you where the process is leaking.
 *
 * An honest limitation, stated because it matters: the app stores each
 * client's CURRENT status, not the history of every stage they passed through.
 * So "reached Contacted" is inferred as everyone currently at Contacted or
 * Won — a deal lost while still a Lead cannot be told apart from one lost
 * after a long negotiation. Tracking every transition would fix that and is
 * the obvious next step.
 */
function drawFunnel(clients) {
  const canvas = document.getElementById('chart-funnel');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const byStatus = (s) => clients.filter((c) => c.status === s).length;

  const stages = [
    { label: 'PROSPECTS', count: clients.length },
    { label: 'ENGAGED', count: byStatus('Contacted') + byStatus('Won') },
    { label: 'WON', count: byStatus('Won') },
  ];

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';

  /* The geometry. Everything below is measured from these five numbers, so
     changing the shape of the funnel means changing them and nothing else.
     `centre` is pulled 40px left of the true middle to leave room on the right
     for the drop-off labels. */
  const top = 26;             // where the first band starts
  const bandHeight = 54;      // how tall each band is
  const gap = 26;             // vertical space between bands, where labels go
  const maxWidth = width - 200;   // the width of a band at 100%
  const centre = width / 2 - 40;  // the vertical axis the bands are centred on
  const accent = chartColor('--phosphor');
  const dim = chartColor('--text-dim');
  const danger = chartColor('--danger');

  stages.forEach((stage, i) => {
    /* Each band's width is its share of the FIRST stage, so the top band is
       always full width and every one below is visibly narrower. Guarding
       against a count of zero matters: 0/0 is NaN, and a NaN width draws
       nothing at all rather than throwing, which is the kind of bug that
       looks like "the chart is broken" with no error in the console. */
    const share = stages[0].count === 0 ? 0 : stage.count / stages[0].count;

    /* A minimum of 6px so a stage with one client out of two hundred is still
       a visible sliver rather than an invisible zero-width rectangle. */
    const bandWidth = Math.max(maxWidth * share, 6);

    /* Stacking downwards: each band drops by its own height plus one gap. */
    const y = top + i * (bandHeight + gap);

    /* Filled first, then outlined, because the outline has to sit on top. The
       fill fades as the funnel narrows — later stages are fewer deals, and the
       lighter fill reinforces that visually. */
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22 + 0.26 * (1 - i / stages.length);
    ctx.fillRect(centre - bandWidth / 2, y, bandWidth, bandHeight);
    /* globalAlpha is a setting on the context, not an argument, so it stays in
       force until something changes it back. Forgetting this line would make
       every later shape on this canvas semi-transparent. */
    ctx.globalAlpha = 1;

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.strokeRect(centre - bandWidth / 2, y, bandWidth, bandHeight);
    ctx.shadowBlur = 0;

    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.fillText(`${stage.label}  ${stage.count}`, centre, y + bandHeight / 2);

    /* The number that makes this a funnel rather than a bar chart: how many
       were lost getting from the stage above to this one. */
    if (i > 0) {
      const previous = stages[i - 1].count;
      const advanced = previous === 0 ? 0 : stage.count / previous;
      const dropped = Math.round((1 - advanced) * 100);

      ctx.fillStyle = dropped >= 50 ? danger : dim;
      ctx.textAlign = 'left';
      ctx.fillText(
        `↓ ${Math.round(advanced * 100)}% advance   −${dropped}% lost`,
        centre + maxWidth / 2 + 16,
        y - gap / 2
      );
    }
  });

  ctx.fillStyle = dim;
  ctx.textAlign = 'left';
  ctx.fillText(`LOST: ${byStatus('Lost')}`, 12, height - 14);

  document.getElementById('chart-funnel-text').textContent =
    `Conversion funnel: ${stages.map((s) => `${s.label} ${s.count}`).join(', ')}. `
    + `Lost ${byStatus('Lost')}.`;
}

/**
 * Set up a chart: clear the canvas, work out the plot area, draw the grid.
 *
 * THE PLOT AREA is the rectangle the data is actually allowed to occupy. It is
 * the canvas inset by four paddings, and those paddings exist to hold things
 * that are not data: the money labels down the left, the month labels along
 * the bottom. Without reserving that space, a long label like "$120,000" would
 * be drawn off the left edge and simply not appear.
 *
 * Returns the numbers the caller needs to place bars, or null if there is no
 * 2-D context — callers check for null rather than assuming.
 */
function beginChart(canvas, maxValue) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const plotLeft = CHART_PAD_LEFT;
  const plotRight = canvas.width - CHART_PAD_RIGHT;
  const plotTop = CHART_PAD_TOP;
  const plotBottom = canvas.height - CHART_PAD_BOTTOM;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';

  /* Four gridlines, evenly spaced, each labelled with the value it represents.
     Read the y calculation carefully, because it is the line that trips people
     up on canvas: it starts at plotBottom and SUBTRACTS, because y grows
     downwards. Line 0 is at the bottom (value 0) and line 4 is at the top
     (value maxValue) — the opposite of what the arithmetic looks like at a
     glance. */
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const y = plotBottom - ((plotBottom - plotTop) * i) / steps;

    ctx.strokeStyle = chartColor('--border');
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = chartColor('--text-dim');
    ctx.textAlign = 'right';
    ctx.fillText(formatMoney(Math.round((maxValue * i) / steps)), plotLeft - 8, y);
  }

  return { ctx, plotLeft, plotRight, plotTop, plotBottom };
}

/**
 * Revenue actually realised, by month.
 *
 * Bucketed by the day the deal CLOSED, not the day it was created — money
 * arrives when the deal is won, and attributing it to the month the lead came
 * in would put this year's revenue in last year's chart.
 */
function drawRevenueChart(clients) {
  const canvas = document.getElementById('chart-revenue');
  const buckets = [];
  const now = new Date();

  /*
    STEP 1 — build one empty bucket per month, oldest first.

    The months are created BEFORE looking at any client, which is the important
    part: it means a month with no revenue still gets a slot and still appears
    on the chart as a zero. Building buckets from the data instead would skip
    empty months silently, and the line would join March to June as though
    nothing had happened in between. A gap in a time series is information.

    `new Date(year, month - back, 1)` handles the year boundary by itself:
    month -1 is December of the previous year, so counting back from January
    needs no special case.
  */
  for (let back = ANALYTICS_MONTHS - 1; back >= 0; back -= 1) {
    const when = new Date(now.getFullYear(), now.getMonth() - back, 1);
    buckets.push({
      label: when.toLocaleDateString(undefined, { month: 'short' }),
      /* Year AND month are both stored, so December 2025 cannot be matched by
         December 2026 when the chart spans a year boundary. */
      year: when.getFullYear(),
      month: when.getMonth(),
      total: 0,
    });
  }

  /* STEP 2 — drop each won deal into the month it closed in. Deals older than
     the window find no bucket and are simply ignored. */
  clients
    .filter((client) => client.status === 'Won')
    .forEach((client) => {
      const when = new Date(client.closedAt || client.createdAt);
      const bucket = buckets.find(
        (b) => b.year === when.getFullYear() && b.month === when.getMonth()
      );
      if (bucket) bucket.total += client.dealValue;
    });

  /* STEP 3 — the scale. The floor of 1000 stops a CRM with no revenue from
     dividing by zero below, which would make every y position NaN and draw an
     empty chart with no error anywhere. */
  const max = Math.max(...buckets.map((b) => b.total), 1000);
  const frame = beginChart(canvas, max);
  if (!frame) return;

  const { ctx, plotLeft, plotRight, plotTop, plotBottom } = frame;
  const accent = chartColor('--phosphor');

  /* Horizontal spacing: the plot width divided by the number of GAPS, which is
     one less than the number of points — six months have five gaps between
     them. Using buckets.length would leave a blank column on the right. */
  const step = (plotRight - plotLeft) / Math.max(buckets.length - 1, 1);

  /*
    Turn a bucket index into a point on the canvas.

    x is straightforward. y is the line worth pausing on: it starts at the
    BOTTOM of the plot and subtracts the bar's height, because canvas y grows
    downwards. More revenue therefore means a SMALLER y. Getting this backwards
    draws the chart upside down, which is the classic first-canvas bug.
  */
  const pointAt = (i) => ({
    x: plotLeft + step * i,
    y: plotBottom - ((plotBottom - plotTop) * buckets[i].total) / max,
  });

  /*
    STEP 4 — the shaded area under the line.

    A path is a shape described before it is drawn: moveTo puts the pen down,
    each lineTo drags it, and closePath joins the end back to the start.
    Nothing appears on screen until fill() or stroke() is called.

    This path goes along the bottom, up through every data point, and back
    down to the bottom right, so closePath seals a proper shape rather than a
    line. Filling a shape that was not closed would give an odd triangle.
  */
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  buckets.forEach((_, i) => { const p = pointAt(i); ctx.lineTo(p.x, p.y); });
  ctx.lineTo(plotRight, plotBottom);
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  buckets.forEach((_, i) => {
    const p = pointAt(i);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  /* shadowBlur on a stroke is how the neon glow is made: the line is drawn
     once, and the browser paints a blurred copy of it underneath in
     shadowColor. It has to be switched back to 0 afterwards, because like
     globalAlpha it is a setting that stays in force and would put a glow
     behind the plain month labels below. */
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  /* STEP 6 — a marker on each data point, and the month name underneath.
     The marker is offset by half its own size (p.x - 3 for a 6px square) so
     it is CENTRED on the point rather than hanging below and right of it:
     fillRect measures from a rectangle's top-left corner, not its middle. */
  ctx.textAlign = 'center';
  buckets.forEach((bucket, i) => {
    const p = pointAt(i);
    ctx.fillStyle = accent;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.fillStyle = chartColor('--text-dim');
    ctx.fillText(bucket.label, p.x, plotBottom + 16);
  });

  /* STEP 7 — the same information as a sentence, in a visually hidden
     paragraph. To a screen reader the canvas above is an image with no
     content; without this, everything the chart says is simply unavailable. */
  document.getElementById('chart-revenue-text').textContent =
    `Revenue won per month: ${buckets.map((b) => `${b.label} ${formatMoney(b.total)}`).join(', ')}.`;
}

/* ==================================================================
   Export
   ================================================================== */

/**
 * Write the client database to a file the user keeps.
 *
 * ======================================================================
 * SECURITY DECISION 5 — the export deliberately omits credentials
 * Explained in full in SECURITY.md, section 5.
 * ======================================================================
 *
 * WHAT IS DELIBERATELY NOT IN HERE: the account. crm_users holds the password
 * in readable text, and a backup file is exactly the kind of thing people mail
 * to themselves or leave in cloud storage. Exporting it would turn a local
 * weakness the assignment forces on us into a portable one — and the email
 * address is left out for the same reason, since it is the other half of a
 * credential.
 *
 * The general lesson is that DATA BECOMES MORE DANGEROUS WHEN IT MOVES. A
 * weakness confined to one browser needs someone at that computer; the same
 * weakness in a file needs nothing at all. So the question to ask of any
 * export is what it is FOR, and then to include only that.
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

  /* Revoked because the object URL holds the blob in memory until the page is
     closed otherwise. */
  URL.revokeObjectURL(url);

  document.getElementById('transfer-status').textContent =
    `> exported ${payload.clients.length} clients`;
  showToast('Export ready ✓', 'success');
}

/* ==================================================================
   Import
   ================================================================== */

/*
  ======================================================================
  SECURITY DECISION 4 — the import file is untrusted input
  Explained in full in SECURITY.md, section 4.
  ======================================================================

  A data URL is only allowed as an image if it actually is one.

  This is the one place in the app where a completely untrusted document
  becomes application data. A file could name anything as an avatar, and that
  string ends up in an <img src>. Restricting it to data:image/... and https://
  means a hand-edited file cannot smuggle in a javascript: or data:text/html
  URL and have the app render it.

  Note the SHAPE of this rule: it lists what is allowed and rejects everything
  else. The opposite approach — listing what is dangerous and blocking that —
  is a bet that you thought of every attack. An allowlist makes no such bet,
  which is why it is the right default whenever you can enumerate the good
  values. The same reasoning governs `status` below.
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
 * already be it. A dealValue arriving as "abc" would poison every total on
 * this page and the dashboard; Number() plus a finite check makes it 0.
 */
function sanitizeImportedClient(raw, index) {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name || '').trim();
  if (name === '') return null;

  const value = Number(raw.dealValue);
  const status = CLIENT_STATUSES.includes(raw.status) ? raw.status : DEFAULT_STATUS;

  return {
    /* Ids are reassigned rather than trusted: a file with two clients sharing
       an id would make deleting one delete both. */
    id: Date.now() + index,
    name,
    email: String(raw.email || '').trim(),
    phone: String(raw.phone || '').trim(),
    company: String(raw.company || '').trim(),
    image: safeImageValue(raw.image),
    avatar: safeImageValue(raw.avatar),
    status,
    dealValue: Number.isFinite(value) && value > 0 ? value : 0,
    notes: Array.isArray(raw.notes)
      ? raw.notes
          .filter((note) => note && typeof note === 'object')
          .map((note) => ({
            text: String(note.text || ''),
            date: String(note.date || ''),
            at: String(note.at || ''),
          }))
      : [],
    createdAt: String(raw.createdAt || new Date().toISOString()),
    /* A closing date only survives import if the deal is actually closed,
       so a file cannot describe an open deal that has already finished. */
    closedAt: isClosedStatus(status) ? String(raw.closedAt || '') : '',
  };
}

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
    input.value = '';
  }
}

/* ==================================================================
   Start-up
   ================================================================== */

function renderAnalytics() {
  const metrics = computeMetrics(analyticsClients);
  const findings = buildFindings(analyticsClients, metrics);

  renderScan(metrics, findings);
  renderFindings(findings);
  renderForecast(metrics);
  drawFunnel(analyticsClients);
  drawRevenueChart(analyticsClients);
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
    document.getElementById('scan-log').textContent =
      '> mounting crm_clients ... FAILED\n> could not reach the API and nothing is cached.';
    return;
  }

  renderAnalytics();

  /* Redraw on theme change: the charts read their colours at draw time, so a
     canvas drawn in dark mode keeps those colours until it is drawn again.
     CSS repaints itself; a canvas does not. */
  const themeButton = document.querySelector('[data-theme-toggle]');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      drawFunnel(analyticsClients);
      drawRevenueChart(analyticsClients);
    });
  }
}

/* Do nothing if the auth guard is already redirecting — see js/app.js. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', initAnalytics);
}
