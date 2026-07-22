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
   Thresholds — every judgement this page makes comes from one of these
   ================================================================== */

/* No contact in this long, and an open deal is considered neglected. */
const NEGLECT_DAYS = 14;

/* A deal open for more than this multiple of the average time to close is
   stalled rather than merely slow. Expressed as a multiple rather than a fixed
   number of days so it adapts to how this particular business actually sells:
   a three-week sales cycle and a six-month one should not share a threshold. */
const STALL_FACTOR = 2;

/* Above this share of revenue from a single client, the business is exposed. */
const CONCENTRATION_WARN = 0.35;

/*
  Below this many won deals, concentration is arithmetic rather than a finding.

  With two wins, one of them is always at least half the revenue. With three,
  an even split is already 33% each, so the 35% threshold fires on the
  slightest imbalance and the page cries wolf. At four or more, 35% genuinely
  means one account is pulling far more weight than the rest.

  Found by a test: a deliberately healthy book of three similar wins was being
  reported as a concentration risk.
*/
const MIN_WON_FOR_CONCENTRATION = 4;

/* Below this many closed deals a win rate is noise, not a statistic. */
const MIN_CLOSED_FOR_RATE = 4;

/* Fallback cycle length before enough deals have closed to measure one. */
const ASSUMED_DAYS_TO_CLOSE = 30;

/* How many months the revenue chart covers. */
const ANALYTICS_MONTHS = 6;

/* How many clients each findings list names before it stops. */
const FINDINGS_LIMIT = 5;

/* Chart geometry, in canvas pixels. */
const CHART_PAD_LEFT = 64;
const CHART_PAD_BOTTOM = 34;
const CHART_PAD_TOP = 18;
const CHART_PAD_RIGHT = 16;

/* Milliseconds between scan lines appearing. */
const SCAN_LINE_MS = 80;

/* The version stamped into an export file. */
const EXPORT_VERSION = 1;

const MS_PER_DAY = 86400000;

let analyticsClients = [];

/* ==================================================================
   Time helpers
   ================================================================== */

/** Whole days between an ISO timestamp and now. */
function daysSince(isoString) {
  const then = new Date(isoString);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.floor((Date.now() - then.getTime()) / MS_PER_DAY);
}

/**
 * When anyone last did anything with this client.
 *
 * The most recent of: the day they were added, the day the deal closed, and
 * the last note written about them.
 *
 * Notes carry two timestamps and this uses `at`, the ISO one, never `date`.
 * `date` is formatted for whoever is reading it, so 05/07/2026 is the fifth of
 * July to one person and the seventh of May to another — fine to display,
 * impossible to compute with. Notes written before that field existed simply
 * do not count towards recency, which is safe: it can only make a client look
 * more neglected than they are, never less.
 */
function lastTouchedAt(client) {
  let latest = new Date(client.createdAt).getTime() || 0;

  if (client.closedAt) {
    latest = Math.max(latest, new Date(client.closedAt).getTime() || 0);
  }

  (client.notes || []).forEach((note) => {
    if (!note.at) return;
    latest = Math.max(latest, new Date(note.at).getTime() || 0);
  });

  return latest;
}

/** Deals still in play. */
function openDeals(clients) {
  return clients.filter((c) => c.status === 'Lead' || c.status === 'Contacted');
}

function sumValue(clients) {
  return clients.reduce((total, client) => total + (client.dealValue || 0), 0);
}

/* ==================================================================
   The metrics
   ================================================================== */

/**
 * Everything the page reports, computed once and shared.
 *
 * Computing these together rather than on demand means the scan, the funnel
 * and the forecast cannot disagree with each other about the same figure.
 */
function computeMetrics(clients) {
  const won = clients.filter((c) => c.status === 'Won');
  const lost = clients.filter((c) => c.status === 'Lost');
  const open = openDeals(clients);
  const closed = won.length + lost.length;

  /* Win rate is closed deals only. Counting open deals as losses would make
     every young pipeline look like a disaster. */
  const winRate = closed === 0 ? 0 : won.length / closed;
  const rateIsMeaningful = closed >= MIN_CLOSED_FOR_RATE;

  /* Average days from opening a deal to closing it, measured only on deals
     that actually have both dates. */
  const withBothDates = [...won, ...lost].filter((c) => c.closedAt && c.createdAt);
  const cycleDays = withBothDates.length === 0
    ? ASSUMED_DAYS_TO_CLOSE
    : Math.round(
        withBothDates.reduce((total, c) => {
          const days = (new Date(c.closedAt) - new Date(c.createdAt)) / MS_PER_DAY;
          return total + Math.max(days, 0);
        }, 0) / withBothDates.length
      );

  const wonValue = sumValue(won);
  const openValue = sumValue(open);

  /* The forecast. An open pipeline total on its own is a wish; multiplied by
     the rate at which deals actually close, it is an estimate. */
  const forecast = Math.round(openValue * winRate);

  /* Momentum: revenue closed this calendar month against last. */
  const now = new Date();
  const monthOf = (client) => {
    const when = new Date(client.closedAt || client.createdAt);
    return `${when.getFullYear()}-${when.getMonth()}`;
  };
  const thisKey = `${now.getFullYear()}-${now.getMonth()}`;
  const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = `${lastDate.getFullYear()}-${lastDate.getMonth()}`;

  const thisMonth = sumValue(won.filter((c) => monthOf(c) === thisKey));
  const lastMonth = sumValue(won.filter((c) => monthOf(c) === lastKey));

  return {
    total: clients.length,
    won, lost, open, closed,
    winRate, rateIsMeaningful, cycleDays,
    wonValue, openValue, forecast,
    avgDeal: clients.length === 0 ? 0 : Math.round(sumValue(clients) / clients.length),
    thisMonth, lastMonth,
  };
}

/* ==================================================================
   The diagnostics
   ================================================================== */

/** Open deals nobody has touched in a fortnight, quietest first. */
function findNeglected(clients) {
  return openDeals(clients)
    .map((client) => ({ client, days: Math.floor((Date.now() - lastTouchedAt(client)) / MS_PER_DAY) }))
    .filter((row) => row.days >= NEGLECT_DAYS)
    .sort((a, b) => b.days - a.days);
}

/**
 * Open deals that have been open far longer than deals normally take.
 *
 * The distinction from "neglected" matters: a neglected deal is one you have
 * not spoken to, a stalled one is a deal you may well be working every week
 * that is simply not moving. They need different responses.
 */
function findStalled(clients, cycleDays) {
  const limit = Math.max(cycleDays * STALL_FACTOR, 1);

  return openDeals(clients)
    .map((client) => ({ client, days: daysSince(client.createdAt) }))
    .filter((row) => row.days > limit)
    .sort((a, b) => b.days - a.days);
}

/**
 * How much of the won revenue comes from the single largest account.
 *
 * A business where one client is most of the income is one bad phone call away
 * from a crisis, and no other view in this app would ever show that.
 */
function findConcentration(metrics) {
  if (metrics.won.length < MIN_WON_FOR_CONCENTRATION || metrics.wonValue === 0) return null;

  const biggest = [...metrics.won].sort((a, b) => b.dealValue - a.dealValue)[0];
  return {
    client: biggest,
    share: biggest.dealValue / metrics.wonValue,
  };
}

/**
 * Turn the raw numbers into a ranked list of findings.
 *
 * Each one carries a level, a one-line verdict, and optionally the clients
 * involved. Sorting by severity puts whatever is most wrong at the top.
 */
function buildFindings(clients, metrics) {
  const findings = [];

  const neglected = findNeglected(clients);
  if (neglected.length > 0) {
    findings.push({
      level: neglected.length >= 5 ? 'FAIL' : 'WARN',
      title: `${neglected.length} open deal${neglected.length === 1 ? '' : 's'} untouched for ${NEGLECT_DAYS}+ days`,
      hint: 'No note, no change, no contact. These go cold next.',
      rows: neglected.slice(0, FINDINGS_LIMIT).map((row) => ({
        name: row.client.name,
        meta: `${row.days} days quiet`,
        value: row.client.dealValue,
      })),
    });
  } else {
    findings.push({ level: 'OK', title: 'Every open deal has been touched recently', rows: [] });
  }

  const stalled = findStalled(clients, metrics.cycleDays);
  if (stalled.length > 0) {
    findings.push({
      level: stalled.length >= 4 ? 'FAIL' : 'WARN',
      title: `${stalled.length} deal${stalled.length === 1 ? '' : 's'} open more than ${STALL_FACTOR}x your ${metrics.cycleDays}-day cycle`,
      hint: 'Long past the point where deals like these normally close.',
      rows: stalled.slice(0, FINDINGS_LIMIT).map((row) => ({
        name: row.client.name,
        meta: `${row.days} days open`,
        value: row.client.dealValue,
      })),
    });
  } else {
    findings.push({ level: 'OK', title: 'No deal is running unusually long', rows: [] });
  }

  const concentration = findConcentration(metrics);
  if (concentration && concentration.share >= CONCENTRATION_WARN) {
    findings.push({
      level: concentration.share >= 0.5 ? 'FAIL' : 'WARN',
      title: `${Math.round(concentration.share * 100)}% of won revenue comes from one client`,
      hint: 'Losing this account would take most of the revenue with it.',
      rows: [{
        name: concentration.client.name,
        meta: `${Math.round(concentration.share * 100)}% of all revenue won`,
        value: concentration.client.dealValue,
      }],
    });
  } else if (concentration) {
    findings.push({ level: 'OK', title: 'Revenue is spread across several accounts', rows: [] });
  }

  if (!metrics.rateIsMeaningful) {
    findings.push({
      level: 'INFO',
      title: `Only ${metrics.closed} deals have closed — win rate is not yet reliable`,
      hint: `Forecasts stay rough until at least ${MIN_CLOSED_FOR_RATE} deals have finished.`,
      rows: [],
    });
  }

  const order = { FAIL: 0, WARN: 1, INFO: 2, OK: 3 };
  return findings.sort((a, b) => order[a.level] - order[b.level]);
}

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

  const top = 26;
  const bandHeight = 54;
  const gap = 26;
  const maxWidth = width - 200;
  const centre = width / 2 - 40;
  const accent = chartColor('--phosphor');
  const dim = chartColor('--text-dim');
  const danger = chartColor('--danger');

  stages.forEach((stage, i) => {
    const share = stages[0].count === 0 ? 0 : stage.count / stages[0].count;
    const bandWidth = Math.max(maxWidth * share, 6);
    const y = top + i * (bandHeight + gap);

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22 + 0.26 * (1 - i / stages.length);
    ctx.fillRect(centre - bandWidth / 2, y, bandWidth, bandHeight);
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
      const when = new Date(client.closedAt || client.createdAt);
      const bucket = buckets.find(
        (b) => b.year === when.getFullYear() && b.month === when.getMonth()
      );
      if (bucket) bucket.total += client.dealValue;
    });

  const max = Math.max(...buckets.map((b) => b.total), 1000);
  const frame = beginChart(canvas, max);
  if (!frame) return;

  const { ctx, plotLeft, plotRight, plotTop, plotBottom } = frame;
  const accent = chartColor('--phosphor');
  const step = (plotRight - plotLeft) / Math.max(buckets.length - 1, 1);

  const pointAt = (i) => ({
    x: plotLeft + step * i,
    y: plotBottom - ((plotBottom - plotTop) * buckets[i].total) / max,
  });

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
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

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

/* ==================================================================
   Export
   ================================================================== */

/**
 * Write the client database to a file the user keeps.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: the account. crm_users holds the password
 * in readable text, and a backup file is exactly the kind of thing people mail
 * to themselves or leave in cloud storage. Exporting it would turn a local
 * weakness the assignment forces on us into a portable one.
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
  A data URL is only allowed as an image if it actually is one.

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
