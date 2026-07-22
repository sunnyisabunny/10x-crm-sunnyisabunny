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
  return {
    id: apiUser.id,
    name: `${apiUser.firstName} ${apiUser.lastName}`,
    email: apiUser.email,
    phone: apiUser.phone,
    company: apiUser.company?.name || '',
    image: apiUser.image,
    status: DEFAULT_STATUS,
    dealValue: randomDealValue(),
    notes: [],
    createdAt: new Date().toISOString(),
  };
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
