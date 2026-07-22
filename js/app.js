/**
 * app.js — the shared shell that runs on all five pages.
 *
 * Four jobs, all of which the assignment says must live in one place rather
 * than being copied onto every page (P0.1, P0.2, P0.3):
 *   1. Auth guard  — decide whether this visitor is allowed to be here
 *   2. Theme       — apply the saved dark/light choice
 *   3. Navigation  — mark the active link, wire Logout and the theme button
 *   4. Easter egg  — the Konami code, which belongs here for exactly the same
 *                    reason as the other three: it is app-wide behaviour
 *
 * WHY THIS SCRIPT IS IN <head> AND NOT DEFERRED
 * Jobs 1 and 2 have to finish before the browser paints anything. If the guard
 * ran after the page had been drawn, opening dashboard.html while logged out
 * would flash the whole dashboard for a moment before bouncing to login — the
 * private data would genuinely appear on screen. Same for the theme: running
 * late gives a visible flash of the wrong colours.
 *
 * Job 3 needs the HTML to exist, so only that part waits for DOMContentLoaded.
 *
 * Each page declares what it is with a data-page attribute on <html>, which is
 * already available at this point because the <html> tag opens before <head>.
 */

/* Pages that require a session. Everything else is public. */
const PROTECTED_PAGES = ['dashboard', 'clients', 'analytics', 'profile'];

const currentPage = document.documentElement.dataset.page || '';

/* ------------------------------------------------------------------
   1. Auth guard (P0.1)
   ------------------------------------------------------------------ */

/**
 * Send the visitor where they belong, and report whether we are redirecting.
 *
 * Two symmetrical rules:
 *   - No session on a protected page  -> go to the login page
 *   - A session on login or signup    -> go to the dashboard, because an
 *     already-logged-in user has no use for a login form
 *
 * Assigning to window.location.href starts a navigation but does not stop the
 * current script, so the caller returns early to avoid doing pointless work on
 * a page that is about to be replaced.
 *
 * This is convenience, not security: anyone can edit localStorage in DevTools.
 * With no backend there is nothing to actually protect — real access control
 * has to happen on a server, which this project does not have.
 */
function applyAuthGuard() {
  const hasSession = getSession() !== null;
  const isProtected = PROTECTED_PAGES.includes(currentPage);

  if (isProtected && !hasSession) {
    window.location.href = 'index.html';
    return true;
  }

  if (!isProtected && hasSession) {
    window.location.href = 'dashboard.html';
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------
   2. Theme (P0.3)
   ------------------------------------------------------------------ */

/**
 * Apply a theme by setting one attribute on <html>.
 *
 * Both themes in tokens.css define the same variable names with different
 * values, so flipping data-theme re-points every colour in the app at once.
 * No component needs to know that themes exist.
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/** Switch to the other theme, save the choice, and update the button label. */
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  applyTheme(next);
  updateThemeButton();
}

/** Show the theme the button will switch TO, which is the useful information. */
function updateThemeButton() {
  const button = document.querySelector('[data-theme-toggle]');
  if (!button) return;

  const goingTo = getTheme() === 'dark' ? 'light' : 'dark';
  button.textContent = getTheme() === 'dark' ? '☀' : '☾';
  button.setAttribute('aria-label', `Switch to ${goingTo} theme`);
}

/* ------------------------------------------------------------------
   3. Navigation (P0.2)
   ------------------------------------------------------------------ */

/**
 * Mark the current page's link and wire the two buttons.
 *
 * The active link is found by comparing each link's data-nav value with the
 * page's own data-page value, so the navigation markup is identical on all
 * three protected pages and nothing has to be hand-edited per page.
 */
function setUpNavigation() {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === currentPage;
    link.classList.toggle('active', isCurrent);
    /* Tells a screen reader which link is the page you are on. */
    if (isCurrent) link.setAttribute('aria-current', 'page');
  });

  const themeButton = document.querySelector('[data-theme-toggle]');
  if (themeButton) themeButton.addEventListener('click', toggleTheme);

  const logoutButton = document.querySelector('[data-logout]');
  if (logoutButton) logoutButton.addEventListener('click', handleLogout);

  updateThemeButton();
}

/**
 * Log out: clear the session and return to login.
 *
 * Only crm_session is removed. Registered accounts (crm_users) and the client
 * database (crm_clients) survive, because logging out is not deleting your
 * data — logging back in must show everything exactly as it was.
 */
function handleLogout() {
  clearSession();
  window.location.href = 'index.html';
}

/* ------------------------------------------------------------------
   4. Easter egg — the Konami code
   ------------------------------------------------------------------ */

/**
 * True when the user is typing, so a shortcut must not steal the keystroke.
 *
 * Lives here rather than in clients.js because two separate features need it —
 * the keyboard shortcuts and this easter egg — and app.js loads before every
 * page script, so putting it here means both can reach it.
 */
function isTyping(target) {
  return target.tagName === 'INPUT'
      || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT'
      || target.isContentEditable;
}

/*
  Up, up, down, down, left, right, left, right, B, A.

  Every key press is appended to a list, the list is trimmed to the length of
  the code, and the two are compared. Trimming as we go is what removes the
  need for any reset logic or an index to keep in step: the list simply holds
  the last ten keys at all times, so a wrong key does not "break" the attempt,
  it just shifts a wrong value into the window.
*/
const KONAMI_CODE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

function setUpEasterEgg() {
  let pressed = [];

  document.addEventListener('keydown', (event) => {
    if (isTyping(event.target)) return;

    /* Arrow keys keep their capitals; single characters are lowercased so
       Shift or caps lock does not break the sequence. */
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    pressed.push(key);
    pressed = pressed.slice(-KONAMI_CODE.length);

    if (pressed.join(',') !== KONAMI_CODE.join(',')) return;

    document.body.classList.toggle('crt-mode');
    const on = document.body.classList.contains('crt-mode');
    showToast(on ? 'CRT MODE ENGAGED' : 'CRT MODE OFF', 'info');
    pressed = [];
  });
}

/* ------------------------------------------------------------------
   Start-up
   ------------------------------------------------------------------ */

/* Make sure the demo account exists before the guard looks for a session. */
seedDemoAccount();

/* Theme first so the correct colours are in place for the very first paint. */
applyTheme(getTheme());

/*
  Run the guard and publish its verdict.

  isRedirecting is deliberately a shared flag that every page script must check
  before it does any work. Setting window.location.href only *starts* a
  navigation — it does not stop the current page. The browser carries on
  parsing, so without this flag dashboard.js and clients.js would still run:
  clients.js would fetch thirty clients from the API, write them to storage,
  and render them into the DOM of a page the visitor is not allowed to see,
  moments before the redirect finally lands.

  So the contract for every page script is:

      if (isRedirecting) { ... do nothing ... }

  A top-level const is visible to the other scripts because classic scripts all
  share one global lexical scope.
*/
const isRedirecting = applyAuthGuard();

if (!isRedirecting) {
  /* The navigation markup does not exist yet, because this script runs inside
     <head> while the body is still being parsed. Wait for the parser to finish.

     The easter egg waits too, for a different reason: it calls showToast(),
     which lives in ui.js — a file that has not been loaded yet at this point.
     By DOMContentLoaded every script on the page has run, so the function is
     there. Wiring it inside the handler rather than calling it now is what
     makes that safe. */
  document.addEventListener('DOMContentLoaded', () => {
    setUpNavigation();
    setUpEasterEgg();
  });
}
