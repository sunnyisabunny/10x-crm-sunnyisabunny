/**
 * dashboard.js — the summary screen (P3).
 *
 * Greeting, live clock, four statistics, the pipeline bar and the five most
 * recent clients. Everything except the clock is derived from the same client
 * list the Clients page uses, so the two can never disagree.
 *
 * Loaded after storage.js, ui.js and data.js.
 */

/* How many clients the "Recent" panel shows, and how far back "this week"
   reaches. Named rather than left as bare numbers in the middle of a
   calculation, so both are easy to find and change. */
const RECENT_CLIENT_COUNT = 5;
const NEW_CLIENT_WINDOW_DAYS = 7;
const MS_PER_DAY = 86400000;

/* How long the counting-up animation on the statistics runs. */
const COUNT_UP_MS = 600;

/* ==================================================================
   Greeting and clock (P3.1)
   ================================================================== */

/**
 * "Welcome back, Nino!" — first word of the logged-in user's full name.
 *
 * The user is looked up fresh from storage rather than read out of the
 * session, so renaming yourself on the profile page is reflected here
 * immediately instead of on the next login.
 */
function renderGreeting() {
  const user = getCurrentUser();
  if (!user) return;

  document.getElementById('greeting').textContent =
    `Welcome back, ${getFirstName(user.fullName)}!`;
}

/**
 * Start the live clock.
 *
 * setInterval re-runs the update every 1000ms. It is called once immediately
 * as well, because setInterval waits a full second before its first run and
 * the page would otherwise show an empty clock for that second.
 *
 * toLocaleDateString and toLocaleTimeString format according to the reader's
 * own locale, so this shows a sensible date order wherever it is opened.
 */
function startClock() {
  const clock = document.getElementById('clock');

  function tick() {
    const now = new Date();
    clock.textContent = `${now.toLocaleDateString()} — ${now.toLocaleTimeString()}`;
  }

  tick();
  setInterval(tick, 1000);
}

/* ==================================================================
   Statistics (P3.2)
   ================================================================== */

/**
 * Count up to a number instead of snapping to it.
 *
 * requestAnimationFrame asks the browser to run the callback before the next
 * repaint, which keeps the animation in step with the display rather than
 * guessing at a frame rate with setInterval.
 */
function countUp(element, target, format = (n) => String(n)) {
  const started = performance.now();

  function frame(now) {
    /* progress goes 0 -> 1 over COUNT_UP_MS. Math.min stops it overshooting
       if a frame arrives late. */
    const progress = Math.min((now - started) / COUNT_UP_MS, 1);
    element.textContent = format(Math.round(target * progress));

    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/**
 * Work out and display all four numbers.
 *
 * Each one is a different array method on purpose — length, filter, reduce and
 * a date comparison — because they are genuinely the right tool for each job.
 */
function renderStats(clients) {
  /* 1. Total — just how many there are. */
  const total = clients.length;

  /* 2. Active deals — anything not yet finished, either way. Written as "not
     Won and not Lost" rather than "Lead or Contacted" so that adding a fifth
     in-progress stage counts automatically. */
  const active = clients.filter(
    (client) => client.status !== 'Won' && client.status !== 'Lost'
  ).length;

  /* 3. Won revenue — filter to the won deals, then reduce their values to a
     single total. reduce starts from 0 so an empty list gives 0, not an
     error. */
  const revenue = clients
    .filter((client) => client.status === 'Won')
    .reduce((sum, client) => sum + client.dealValue, 0);

  /* 4. New this week — added within the last seven days. Subtracting two
     dates gives the gap in milliseconds; dividing by the number of
     milliseconds in a day turns that into days. */
  const newThisWeek = clients.filter((client) => {
    const ageInDays = (Date.now() - new Date(client.createdAt)) / MS_PER_DAY;
    return ageInDays <= NEW_CLIENT_WINDOW_DAYS;
  }).length;

  countUp(document.getElementById('stat-total'), total);
  countUp(document.getElementById('stat-active'), active);
  countUp(document.getElementById('stat-revenue'), revenue, formatMoney);
  countUp(document.getElementById('stat-new'), newThisWeek);
}

/* ==================================================================
   Pipeline overview (P3.3)
   ================================================================== */

/**
 * A single bar split into one segment per stage, sized by how many clients
 * are in it, plus a written legend underneath.
 *
 * The legend is not decoration. It states each count in words, so the chart
 * is readable by someone who cannot distinguish the segment colours.
 */
function renderPipeline(clients) {
  const counts = countByStatus(clients);
  const bar = document.getElementById('pipeline');
  const legend = document.getElementById('pipeline-legend');

  bar.replaceChildren();
  legend.replaceChildren();

  CLIENT_STATUSES.forEach((status) => {
    const count = counts[status];
    const slug = status.toLowerCase();

    /* A zero-count stage gets no segment — a zero-width block would render as
       a thin sliver of colour meaning nothing. It still appears in the
       legend, so the information is not lost. */
    if (count > 0) {
      const segment = document.createElement('div');
      segment.className = `pipeline__seg pipeline__seg--${slug}`;
      /* flex-grow proportional to the count is what sizes each segment
         relative to the others, with no arithmetic needed. */
      segment.style.flex = String(count);
      segment.textContent = count;
      bar.append(segment);
    }

    const item = document.createElement('span');
    item.className = `pipeline-legend__item pipeline-legend__item--${slug}`;
    item.textContent = `${status} ${count}`;
    legend.append(item);
  });

  bar.setAttribute(
    'aria-label',
    CLIENT_STATUSES.map((status) => `${status}: ${counts[status]}`).join(', ')
  );
}

/* ==================================================================
   Recent clients (P3.4)
   ================================================================== */

/**
 * The five most recently added clients, newest first.
 *
 * Sorted on a copy, because sort() rearranges the array it is given and this
 * one is the live client list.
 */
function renderRecent(clients) {
  const container = document.getElementById('recent-list');
  container.replaceChildren();

  const recent = [...clients]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, RECENT_CLIENT_COUNT);

  if (recent.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-faint';
    empty.textContent = 'No clients yet.';
    container.append(empty);
    return;
  }

  recent.forEach((client) => {
    const row = document.createElement('div');
    row.className = 'recent-row';

    const left = document.createElement('div');
    left.className = 'stack-2';

    const name = document.createElement('strong');
    name.textContent = client.name;          // textContent: untrusted value

    const company = document.createElement('span');
    company.className = 'text-dim';
    company.style.fontSize = 'var(--fs-sm)';
    company.textContent = client.company || '—';

    left.append(name, company);

    const right = document.createElement('div');
    right.className = 'row';

    const badge = document.createElement('span');
    badge.className = `badge badge--${client.status.toLowerCase()}`;
    badge.textContent = client.status;

    const added = document.createElement('span');
    added.className = 'mono text-faint';
    added.style.fontSize = 'var(--fs-xs)';
    added.textContent = formatDate(client.createdAt);

    right.append(badge, added);
    row.append(left, right);
    container.append(row);
  });
}

/* ==================================================================
   Start-up
   ================================================================== */

async function initDashboard() {
  renderGreeting();
  startClock();

  try {
    /* The same loader the Clients page uses: saved data if there is any,
       otherwise the API. Sharing it is what keeps the numbers here in step
       with the list there. */
    const clients = await loadClients();
    renderStats(clients);
    renderPipeline(clients);
    renderRecent(clients);
  } catch (error) {
    console.error('Could not load clients for the dashboard.', error);
    showToast('Could not load clients. Check your connection and try again.', 'error');
  }
}

/* Do nothing if the auth guard is already sending this visitor to the login
   page — see the explanation in js/app.js. */
if (!isRedirecting) {
  initDashboard();
}
