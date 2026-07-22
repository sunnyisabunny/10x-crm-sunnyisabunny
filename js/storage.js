/**
 * storage.js — the ONLY file in this project that talks to localStorage.
 *
 * Every other file goes through the functions below instead of calling
 * localStorage directly. That means the four storage keys are written down in
 * exactly one place, so a typo like "crm_user" can only ever happen once, and
 * renaming a key is a one-line change rather than a hunt through five pages.
 *
 * Loaded first on every page — everything else depends on it.
 */

/* The four keys the assignment fixes. These names are mandatory: the evaluator
   opens DevTools > Application > Local Storage and checks for them by name. */
const STORAGE_KEYS = {
  users: 'crm_users',      // array of User objects — every registered account
  session: 'crm_session',  // one Session object — who is currently logged in
  clients: 'crm_clients',  // array of Client objects — the app's main state
  theme: 'crm_theme',      // the string "dark" or "light"
};

const DEFAULT_THEME = 'dark';

/* Seeded on first run so somebody opening the live site can log straight in
   without registering. localStorage is per-browser, so a "test account" only
   exists if the app creates it. Documented in the README. */
const DEMO_ACCOUNT = {
  fullName: 'Demo Manager',
  email: 'demo@test.com',
  password: 'demo1234',
  company: '10X Sales',
};

/* ------------------------------------------------------------------
   Low-level helpers

   Everything stored in localStorage is a string, so objects and arrays have to
   be converted with JSON.stringify going in and JSON.parse coming out.

   Both helpers are wrapped in try/catch. localStorage genuinely can throw: the
   stored JSON may be corrupt if a user edited it by hand, and setItem throws
   when the storage quota is full or when the browser is in a locked-down
   privacy mode. Without the catch, one bad value would break every page.
   ------------------------------------------------------------------ */

/**
 * Read and parse a JSON value. Returns `fallback` if the key is missing or the
 * stored text is not valid JSON.
 */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    // getItem returns null (not undefined) when a key has never been set.
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`storage: could not read "${key}", using fallback.`, error);
    return fallback;
  }
}

/** Serialise and store a value. Returns true on success, false on failure. */
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`storage: could not write "${key}".`, error);
    return false;
  }
}

/* ------------------------------------------------------------------
   Users — crm_users
   ------------------------------------------------------------------ */

function getUsers() {
  return readJSON(STORAGE_KEYS.users, []);
}

function saveUsers(users) {
  return writeJSON(STORAGE_KEYS.users, users);
}

/**
 * Find a registered account by email.
 *
 * Emails are compared in lowercase on both sides, so "Nino@Example.com" and
 * "nino@example.com" are treated as the same account. Registration stores the
 * lowercase form; this makes the lookup agree with that.
 */
function findUserByEmail(email) {
  const wanted = String(email).trim().toLowerCase();
  return getUsers().find((user) => user.email.toLowerCase() === wanted);
}

/** True if an account with this email already exists (used by signup). */
function emailIsTaken(email) {
  const wanted = String(email).trim().toLowerCase();
  return getUsers().some((user) => user.email.toLowerCase() === wanted);
}

function findUserById(id) {
  return getUsers().find((user) => user.id === id);
}

/**
 * Overwrite one user in the array and save.
 *
 * Used by the profile page for both "save changes" and "change password".
 * `changes` is merged over the existing object, so a caller only has to pass
 * the fields it actually wants to alter.
 */
function updateUser(id, changes) {
  const users = getUsers();
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) return false;

  users[index] = { ...users[index], ...changes };
  return saveUsers(users);
}

/* ------------------------------------------------------------------
   Session — crm_session
   ------------------------------------------------------------------ */

function getSession() {
  return readJSON(STORAGE_KEYS.session, null);
}

function saveSession(session) {
  return writeJSON(STORAGE_KEYS.session, session);
}

/**
 * Log out. Removes ONLY the session — registered accounts and client data are
 * deliberately left in place, because logging out is not the same as deleting
 * your data. The assignment calls this out explicitly.
 */
function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

/**
 * The full User object for whoever is logged in, or null if nobody is.
 *
 * The session only stores an id and email, not the whole user. Looking the
 * account up fresh each time means that if the profile page changes the user's
 * name, every page shows the new name immediately — a copy inside the session
 * would go stale.
 */
function getCurrentUser() {
  const session = getSession();
  if (!session) return null;
  return findUserById(session.userId) || null;
}

/* ------------------------------------------------------------------
   Clients — crm_clients
   ------------------------------------------------------------------ */

/**
 * The stored client list, or null if it has never been saved.
 *
 * The null matters. It lets the caller tell apart two different situations
 * that an empty array would blur together:
 *   null -> never loaded, so go and fetch from the API
 *   []   -> loaded fine, the user has simply deleted everyone
 * Returning [] in both cases would re-download the API list every time the
 * last client was deleted.
 */
function getClients() {
  return readJSON(STORAGE_KEYS.clients, null);
}

function saveClients(clients) {
  return writeJSON(STORAGE_KEYS.clients, clients);
}

/** Used by "Reset CRM Data" on the profile page, before re-fetching. */
function clearClients() {
  localStorage.removeItem(STORAGE_KEYS.clients);
}

/* ------------------------------------------------------------------
   Theme — crm_theme
   ------------------------------------------------------------------ */

/* Stored as a plain string rather than JSON, because it is already a string. */
function getTheme() {
  return localStorage.getItem(STORAGE_KEYS.theme) || DEFAULT_THEME;
}

function saveTheme(theme) {
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

/* ------------------------------------------------------------------
   First-run seeding
   ------------------------------------------------------------------ */

/**
 * Create the demo account if no accounts exist yet.
 *
 * Runs on every page load but only does work once, because after the first run
 * getUsers() is no longer empty. Registering normally is unaffected.
 */
function seedDemoAccount() {
  if (getUsers().length > 0) return;

  saveUsers([
    {
      id: Date.now(),
      fullName: DEMO_ACCOUNT.fullName,
      email: DEMO_ACCOUNT.email,
      password: DEMO_ACCOUNT.password,
      company: DEMO_ACCOUNT.company,
      createdAt: new Date().toISOString(),
    },
  ]);
}

/*
  SECURITY NOTE — read this before the exam.

  This project stores passwords as plain text in localStorage. In a real
  product that is completely unacceptable, for three reasons:

  1. localStorage is readable by any JavaScript running on the page, so a
     single cross-site-scripting bug hands over every password at once.
  2. Passwords should never be stored in a recoverable form at all. A real
     backend stores a slow one-way hash (bcrypt, scrypt, argon2) plus a random
     per-user salt, so even the people running the server cannot read them.
  3. Because people reuse passwords, leaking one here also compromises the
     same person's email and bank accounts.

  It is done this way here only because the assignment forbids a backend, and
  hashing on the client would be security theatre — whatever the client can
  compute, an attacker reading the same code can compute too.
*/
