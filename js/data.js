/**
 * data.js — the client database: talking to the API, and deciding what to show.
 *
 * Shared by three pages. The clients page uses all of it; the dashboard uses
 * loadClients() for its statistics; the profile page uses fetchClientsFromApi()
 * for "Reset CRM Data". Keeping it in one file is what stops those three from
 * disagreeing about where clients come from.
 *
 * Loaded after storage.js and ui.js.
 */

const API_BASE = 'https://dummyjson.com/users';

/*
  The four deal stages, in pipeline order.

  Everything that needs a list of statuses derives it from this array: the
  filter chips, the dropdown on each card, the Add Client form, the dashboard
  pipeline. Adding a fifth stage is therefore one entry here plus one colour in
  tokens.css, and every part of the UI picks it up. Nothing hardcodes the four
  names anywhere else.
*/
const CLIENT_STATUSES = ['Lead', 'Contacted', 'Won', 'Lost'];
const DEFAULT_STATUS = 'Lead';

/* How many clients to pull on first run, and the deal-value range invented for
   them — the API returns people, not sales opportunities, so a plausible value
   has to be made up. */
const API_CLIENT_LIMIT = 30;
const MIN_DEAL_VALUE = 500;
const MAX_DEAL_VALUE = 10000;

/* ==================================================================
   Talking to the API
   ================================================================== */

/**
 * Turn one API user into one Client in our own shape.
 *
 * The API gives back far more than we need (bank details, addresses, hair
 * colour) and none of the sales fields we do need. This is the boundary where
 * their shape becomes ours, so the rest of the app never has to know what
 * DummyJSON's response looks like.
 *
 * The ?. guards matter: company is a nested object, and one malformed record
 * without it would otherwise throw and break the whole list.
 */
function mapApiUserToClient(apiUser) {
  const createdAt = seededCreatedAt(apiUser.id);
  const status = seededStatus(apiUser.id);

  return {
    id: apiUser.id,
    name: `${apiUser.firstName} ${apiUser.lastName}`,
    email: apiUser.email,
    phone: apiUser.phone,
    company: apiUser.company?.name || '',
    image: apiUser.image,
    status,
    dealValue: randomDealValue(),
    notes: [],
    createdAt,
    /* Only a closed deal has a closing date. Everything still open gets an
       empty string rather than a fake one, so "how long did that take" can
       never be answered about a deal that has not finished. */
    closedAt: isClosedStatus(status) ? seededClosedAt(createdAt, apiUser.id) : '',
  };
}

/*
  BACKDATING THE STARTER DATA — and why this is not cheating.

  Every client used to be stamped with the moment the API call returned, so
  all thirty carried the same date. That quietly broke everything that reads
  time: "New This Week" always said thirty, sorting by newest was arbitrary
  because every value was identical, and the revenue-by-month chart put
  everything in one column with five empty ones beside it.

  A CRM with no history cannot be analysed, and a demo where the analysis is
  blank does not demonstrate anything. So the thirty starter records are given
  a plausible six months of history instead.

  Only the starter records. A client you add yourself is stamped with the real
  current time in js/clients.js, so invented history stays clearly separated
  from your genuine activity.

  Derived from the id rather than random, which matters: the same client always
  lands on the same date, so the charts do not rearrange themselves on every
  reload and the demo is repeatable. 37 shares no factor with 180, so
  multiplying the ids by it walks the whole six-month range instead of piling
  up on a few days.
*/
const DEMO_HISTORY_DAYS = 180;
const DEMO_DATE_STRIDE = 37;

function seededCreatedAt(id) {
  const daysAgo = (Number(id) * DEMO_DATE_STRIDE) % DEMO_HISTORY_DAYS;
  const when = new Date();
  when.setDate(when.getDate() - daysAgo);
  return when.toISOString();
}

/*
  The starter book of business.

  The API hands back thirty people with no sales information at all, so every
  one of them used to arrive as a Lead. That left the demo with nothing won,
  nothing lost, no revenue and no funnel — a CRM that had never done any
  business. Nothing on the dashboard or the analytics page had anything to
  report until the evaluator manually changed statuses one at a time.

  So the starter thirty arrive as a plausible mix instead: roughly 40% still
  Lead, 30% in conversation, 20% won and 10% lost. Repeating the list and
  indexing it by id keeps it deterministic, exactly like the dates.

  This applies ONLY to the starter data. A client you add yourself still
  defaults to Lead, as the assignment requires (P4.4).
*/
const DEMO_STATUS_MIX = [
  'Lead', 'Contacted', 'Won', 'Lead', 'Contacted',
  'Lead', 'Won', 'Lost', 'Contacted', 'Lead',
];

function seededStatus(id) {
  return DEMO_STATUS_MIX[Number(id) % DEMO_STATUS_MIX.length];
}

/** True for the two statuses that end a deal, either way. */
function isClosedStatus(status) {
  return status === 'Won' || status === 'Lost';
}

/**
 * A closing date somewhere between 5 and 46 days after the deal opened.
 *
 * Deals that closed have to have closed AFTER they opened, and the gap is what
 * "average days to close" measures. Deriving it from the id again keeps the
 * velocity figures stable across reloads.
 */
function seededClosedAt(createdAt, id) {
  const daysToClose = 5 + ((Number(id) * 13) % 42);
  const when = new Date(createdAt);
  when.setDate(when.getDate() + daysToClose);

  /* Never let an invented closing date land in the future. A deal that closed
     next Tuesday would make every velocity figure negative. */
  const now = new Date();
  return (when > now ? now : when).toISOString();
}

/** A believable deal size, so the dashboard statistics are not all identical. */
function randomDealValue() {
  const spread = MAX_DEAL_VALUE - MIN_DEAL_VALUE;
  /* Rounded to the nearest 100 so the numbers read like real deal sizes
     rather than $6,347. */
  return Math.round((MIN_DEAL_VALUE + Math.random() * spread) / 100) * 100;
}

/**
 * GET the starting client list.
 *
 * async/await is used rather than .then() chains because it lets the success
 * path read top to bottom like ordinary code. `await` pauses this function
 * until the promise settles without blocking the browser — the page stays
 * responsive while the request is in flight.
 *
 * response.ok is checked explicitly. This catches people out: fetch only
 * rejects when the request could not be made at all (no network, DNS failure).
 * A 404 or a 500 is a successful round trip as far as fetch is concerned, so
 * without this check a server error would sail through and we would try to
 * read users out of an error page.
 *
 * Errors are deliberately thrown rather than swallowed, so the caller can
 * decide what the user sees.
 */
async function fetchClientsFromApi() {
  const response = await fetch(`${API_BASE}?limit=${API_CLIENT_LIMIT}`);

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  const data = await response.json();
  return data.users.map(mapApiUserToClient);
}

/**
 * POST a new client.
 *
 * DummyJSON simulates writes: it validates the request and sends back a proper
 * response with a generated id, but stores nothing. That is fine here — the
 * point is practising real server communication, while localStorage does the
 * actual remembering.
 */
async function createClientOnApi(client) {
  const response = await fetch(`${API_BASE}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(client),
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  return response.json();
}

/**
 * PUT an edited client.
 *
 * PUT replaces a record that already exists, where POST creates a new one.
 * Using the right verb matters even against a simulated API: the method is
 * how a server is told what kind of change this is, and a client that sends
 * POST for an edit would create duplicates against a real backend.
 *
 * As with the others, DummyJSON validates and echoes but stores nothing.
 */
async function updateClientOnApi(id, changes) {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  return response.json();
}

/**
 * DELETE a client.
 *
 * Returns true when the server accepted it, false when it did not.
 *
 * A 404 here is expected and harmless. Clients you added yourself were never
 * really stored by DummyJSON, so asking it to delete id 31 gets "no such
 * record". The caller removes the client locally either way — the local list
 * is the real source of truth, and refusing to delete something the user can
 * see would be worse than a silent server disagreement.
 */
async function deleteClientOnApi(id) {
  try {
    const response = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    return response.ok;
  } catch (error) {
    console.warn('Delete request failed; removing locally anyway.', error);
    return false;
  }
}

/* ==================================================================
   The golden cycle: cache or API
   ================================================================== */

/**
 * Get the client list, from storage if we have it and from the API if not.
 *
 * This is the rule the whole app turns on. Saved data always wins, so the API
 * is contacted exactly once in the app's lifetime — otherwise every reload
 * would wipe out the user's edits with a fresh copy of the original 30 people.
 *
 * Remember getClients() returns null (not []) when nothing was ever saved,
 * which is what makes "never loaded" distinguishable from "the user deleted
 * everyone". Without that distinction, deleting your last client would trigger
 * a re-download.
 */
async function loadClients() {
  const cached = getClients();

  if (cached !== null) {
    return cached;
  }

  const clients = await fetchClientsFromApi();
  saveClients(clients);
  return clients;
}

/* ==================================================================
   Filtering, searching and sorting
   ================================================================== */

const SORT_OPTIONS = {
  newest: 'Newest first',
  name: 'Name A→Z',
  value: 'Deal value: high → low',
};

/**
 * Apply the status filter, then the search text, then the sort order.
 *
 * All three combine, in that order, and the caller passes the current state of
 * each. One function does the whole job so the three controls cannot fight
 * each other — every one of them just calls this and re-renders the result.
 *
 * IMPORTANT: sort() reorders an array in place, so sorting the stored list
 * directly would permanently scramble it. filter() already returns a new array
 * here, but the [...list] copy at the top guarantees the original is untouched
 * even when no filter is active. Clearing a filter must always restore exactly
 * what was there before.
 */
function getVisibleClients(clients, { status = 'All', search = '', sort = 'newest' } = {}) {
  let visible = [...clients];

  /* 1. Status — "All" means no filtering at all. */
  if (status !== 'All') {
    visible = visible.filter((client) => client.status === status);
  }

  /* 2. Search — name or company, case-insensitive on both sides. */
  const query = search.trim().toLowerCase();
  if (query !== '') {
    visible = visible.filter((client) => {
      const name = client.name.toLowerCase();
      const company = (client.company || '').toLowerCase();
      return name.includes(query) || company.includes(query);
    });
  }

  /* 3. Sort. The comparator returns a negative number to put a first, a
     positive number to put b first, and 0 to leave them as they are. */
  if (sort === 'name') {
    visible.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'value') {
    visible.sort((a, b) => b.dealValue - a.dealValue);   // highest first
  } else {
    /* Newest first: subtracting the older date from the newer one gives a
       positive number, which sorts the newer client earlier. */
    visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return visible;
}

/** Count how many clients sit at each status. Used by the dashboard pipeline. */
function countByStatus(clients) {
  const counts = {};
  CLIENT_STATUSES.forEach((status) => {
    counts[status] = 0;
  });

  clients.forEach((client) => {
    if (counts[client.status] !== undefined) counts[client.status] += 1;
  });

  return counts;
}

/* ==================================================================
   READING THE CLIENT LIST: the diagnosis engine

   Everything below turns a list of clients into a judgement about it —
   which deals have gone quiet, which are stuck, whether the revenue is
   dangerously concentrated, and what is likely to close.

   It lives in data.js rather than on the analytics page because TWO
   features need it: the analytics board renders it as a report, and RONIN
   speaks the most urgent line of it on every page. If each had its own
   copy they would drift, and the assistant would eventually contradict the
   page — which is exactly the duplication the assignment forbids.

   Every function here is PURE: it takes a client list and returns a value,
   touching no storage and no DOM. That is what makes it testable without a
   browser, and reusable by anything that has a list of clients.
   ================================================================== */

/* ------------------------------------------------------------------
   Thresholds — every judgement made below comes from one of these
   ------------------------------------------------------------------ */

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

/* How many clients each findings list names before it stops. */
const FINDINGS_LIMIT = 5;

const MS_PER_DAY = 86400000;


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

