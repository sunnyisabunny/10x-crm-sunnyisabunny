/**
 * assistant.js — RONIN, the pixel samurai.
 *
 * A cyberpunk ronin gunslinger who stands in the bottom-left corner, breathes,
 * blinks, and says something useful when clicked.
 *
 * HOW THE ART WORKS
 * There is no image file. The sprite is a plain array of strings, one string
 * per row of pixels and one character per pixel, where each character is a key
 * into a small colour palette. A nested loop walks that grid and paints one
 * filled rectangle per pixel onto a <canvas>.
 *
 * That choice buys three things:
 *   - nothing to download, so he works offline like the rest of the app
 *   - the art is data, not code: changing his coat colour is one hex value,
 *     and changing his shape is editing a string
 *   - the visor colour is read from the live CSS variable, so he re-colours
 *     with the theme and turns green with the rest of the app in CRT mode,
 *     without a single extra sprite
 *
 * Loaded after ui.js, because the speech bubble borrows its escape rules.
 */

/* Each sprite pixel is drawn this many screen pixels across. The sprite is
   24x32, so at 4x he occupies 96x128. */
const RONIN_SCALE = 4;

/* Idle timings. The blink delay is randomised between these two so he never
   falls into a visible rhythm — a perfectly regular blink reads as a machine,
   an irregular one reads as alive. */
const RONIN_BLINK_MIN_MS = 2600;
const RONIN_BLINK_MAX_MS = 7000;
const RONIN_BLINK_HOLD_MS = 140;
const RONIN_BREATH_MS = 1100;

/* Speech bubble. */
const RONIN_TYPE_MS = 26;
const RONIN_BUBBLE_MS = 7000;

/* ==================================================================
   The art
   ================================================================== */

const RONIN_PALETTE = {
  ' ': null,        // transparent
  K: '#05060A',     // outline
  H: '#1A1030',     // helmet and the dark crown of the hat
  h: '#2A1C4A',     // hat highlight
  V: '#00F0FF',     // visor — overridden at draw time by the live accent
  C: '#16203A',     // coat
  c: '#111A2E',     // arms, a shade darker so they separate from the coat
  D: '#0A0F20',     // coat seam and skirt shadow
  R: '#FF2E97',     // scarf
  M: '#C8D4E8',     // katana blade
  m: '#7A88A8',     // hilt
  B: '#2A1810',     // boots
  G: '#B6FF3C',     // belt
};

const RONIN_FRAMES = {
  idle: [
    '         KKKKKK         ',
    '        KhhhhhhK        ',
    '       KhhHHHHhhK       ',
    '      KhhhHHHHhhhK      ',
    '     KhhhhHHHHhhhhK     ',
    '  KKKhhhhhhhhhhhhhhKKK  ',
    ' KKKKKKKKKKKKKKKKKKKKKK ',
    '        KHHHHHHK   MMK  ',
    '        KVVVVVVK  MMK   ',
    '        KVVVVVVK MMK    ',
    '        KHHHHHHKMMK     ',
    '      KKRRRRRRRRKmK     ',
    '     KRRRRRRRRRRRRK     ',
    '   KccKCCCCCCCCCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KccKCCGGGGGGCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KccKCCCCDDCCCCKccK   ',
    '   KKKKCCCCDDCCCCKKKK   ',
    '   KDDCCCCCDDCCCCCDDK   ',
    '  KDDDCCCCCDDCCCCCDDDK  ',
    '  KDDDCCCCCDDCCCCCDDDK  ',
    ' KDDDDCCCCCDDCCCCCDDDDK ',
    ' KDDDDDDDDDDDDDDDDDDDDK ',
    '  KKKKKKKKKKKKKKKKKKKK  ',
    '      KBBBK  KBBBK      ',
    '      KBBBK  KBBBK      ',
    '     KBBBBK  KBBBBK     ',
    '     KKKKKK  KKKKKK     ',
  ],
};

/*
  The blink frame is generated, not drawn.

  It is the idle frame with the two visor rows switched from V to H — his eyes
  closing. Deriving it means the two frames can never drift apart: any change
  to his coat or his hat automatically appears in both.
*/
RONIN_FRAMES.blink = RONIN_FRAMES.idle.map((row, index) =>
  index === 8 || index === 9
    ? row.replace(/V+/g, (run) => 'H'.repeat(run.length))
    : row
);

/* ==================================================================
   What he says
   ================================================================== */

/*
  One list per page, chosen by the data-page attribute the guard already reads.
  He is a assistant rather than decoration: most of these point at something
  real the user can do on the page they are actually looking at.
*/
const RONIN_LINES = {
  dashboard: [
    'Four numbers, one truth. Won revenue only counts deals you closed.',
    'The clock is live. Everything else is counted from your client list.',
    'Pipeline looking thin? Head to Clients and move something to Contacted.',
    'I have been standing here since the last reload. Nothing escapes me.',
  ],
  clients: [
    'Press / to search. Press ? if you want the whole list of shortcuts.',
    'Filter, search and sort all stack. Use all three at once, partner.',
    'Every client keeps a note history. Open one and write down what was said.',
    'Deleted someone by mistake? That one does not come back. Aim carefully.',
    'Thirty souls came in from the wire. The rest are yours.',
  ],
  analytics: [
    'Revenue counts closed deals only. Hope is not income.',
    'Export writes a file you keep. Your password never goes in it.',
    'Import replaces every client you have. Read the warning twice.',
    'The bars are total value, not headcount. One whale beats ten minnows.',
  ],
  profile: [
    'Change your name here and the dashboard greeting follows you.',
    'Reset wipes the client list. Your account survives it.',
    'A new password needs the old one first. No shortcuts through that door.',
    'A photo gets shrunk to 128 pixels before it is saved. Storage is finite.',
  ],
};

const RONIN_GREETING = 'RONIN online. Click me if you get lost out there.';

/* ==================================================================
   Drawing
   ================================================================== */

let roninCanvas = null;
let roninCtx = null;
let roninFrame = 'idle';
let roninBreath = 0;      /* 0 or 1 — a one-pixel vertical shift */
let roninBubble = null;
let roninTypeTimer = null;
let roninHideTimer = null;

/**
 * Read the app's current accent colour so the visor matches the theme.
 *
 * CRT mode redefines --accent on <body>, and the light theme darkens it, so
 * reading it live is what lets one sprite serve every theme. Falls back to the
 * palette's own value if the variable is missing for any reason.
 */
function roninVisorColor() {
  const live = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  return live || RONIN_PALETTE.V;
}

/**
 * Paint one frame.
 *
 * The nested loop is the whole renderer: outer loop walks rows, inner loop
 * walks the characters in that row, and each non-space character becomes one
 * filled square. clearRect first, because canvas draws on top of whatever was
 * there before rather than replacing it.
 */
function drawRonin() {
  const rows = RONIN_FRAMES[roninFrame];
  const visor = roninVisorColor();

  roninCtx.clearRect(0, 0, roninCanvas.width, roninCanvas.height);

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];

    for (let x = 0; x < row.length; x += 1) {
      const key = row[x];
      if (key === ' ') continue;

      const color = key === 'V' ? visor : RONIN_PALETTE[key];
      if (!color) continue;

      roninCtx.fillStyle = color;
      roninCtx.fillRect(
        x * RONIN_SCALE,
        (y + roninBreath) * RONIN_SCALE,
        RONIN_SCALE,
        RONIN_SCALE
      );
    }
  }
}

/* ==================================================================
   Idle life
   ================================================================== */

/*
  Deliberately timers rather than requestAnimationFrame.

  rAF is the right tool when something changes every single frame — the
  dashboard's count-up does, so it uses rAF. RONIN changes about twice a
  second. Running him at 60fps would mean redrawing 768 rectangles sixty times
  a second to show the same picture, which is real battery for no visible gain.
*/
function startRoninBreathing() {
  setInterval(() => {
    roninBreath = roninBreath === 0 ? 1 : 0;
    drawRonin();
  }, RONIN_BREATH_MS);
}

function scheduleRoninBlink() {
  const spread = RONIN_BLINK_MAX_MS - RONIN_BLINK_MIN_MS;
  const delay = RONIN_BLINK_MIN_MS + Math.random() * spread;

  setTimeout(() => {
    roninFrame = 'blink';
    drawRonin();

    setTimeout(() => {
      roninFrame = 'idle';
      drawRonin();
      scheduleRoninBlink();
    }, RONIN_BLINK_HOLD_MS);
  }, delay);
}

/* ==================================================================
   Speech
   ================================================================== */

/**
 * Say something, one character at a time.
 *
 * The typewriter is an interval that appends the next character until the
 * string runs out. textContent is used rather than innerHTML for the same
 * reason as everywhere else in this app: it treats the value as characters to
 * display, never as markup to run.
 *
 * Any previous line is cancelled first, so clicking twice quickly does not
 * leave two intervals racing to write into the same element.
 */
function roninSay(text) {
  clearInterval(roninTypeTimer);
  clearTimeout(roninHideTimer);

  roninBubble.hidden = false;
  roninBubble.textContent = '';

  let index = 0;
  roninTypeTimer = setInterval(() => {
    index += 1;
    roninBubble.textContent = text.slice(0, index);

    if (index >= text.length) {
      clearInterval(roninTypeTimer);
      roninHideTimer = setTimeout(() => { roninBubble.hidden = true; }, RONIN_BUBBLE_MS);
    }
  }, RONIN_TYPE_MS);
}

/** A line for the page we are actually on, never the same one twice running. */
let roninLastLine = '';

function roninNextLine() {
  const lines = RONIN_LINES[currentPage] || [RONIN_GREETING];
  if (lines.length === 1) return lines[0];

  let pick = roninLastLine;
  while (pick === roninLastLine) {
    pick = lines[Math.floor(Math.random() * lines.length)];
  }
  roninLastLine = pick;
  return pick;
}

/* ==================================================================
   Build
   ================================================================== */

function buildRonin() {
  const rows = RONIN_FRAMES.idle;

  const root = document.createElement('div');
  root.className = 'ronin';

  roninBubble = document.createElement('div');
  roninBubble.className = 'ronin__bubble';
  roninBubble.hidden = true;
  /* Announces his lines to a screen reader without moving focus. */
  roninBubble.setAttribute('role', 'status');
  roninBubble.setAttribute('aria-live', 'polite');

  /* A real <button>, not a clickable div, so it is keyboard reachable and
     announces itself correctly. The canvas inside is decorative. */
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ronin__btn';
  button.setAttribute('aria-label', 'RONIN, your assistant. Activate for a tip.');

  roninCanvas = document.createElement('canvas');
  roninCanvas.className = 'ronin__canvas';
  /* +1 row of height so the one-pixel breathing shift has somewhere to go
     instead of clipping his boots off. */
  roninCanvas.width = rows[0].length * RONIN_SCALE;
  roninCanvas.height = (rows.length + 1) * RONIN_SCALE;
  roninCanvas.setAttribute('aria-hidden', 'true');

  roninCtx = roninCanvas.getContext('2d');

  /* getContext returns null when canvas is unavailable — some privacy modes
     block it, and headless test environments often have no 2-D backend at all.
     He is decoration, so the correct response is to leave quietly rather than
     throw and take the rest of the page's scripts down with him. */
  if (!roninCtx) return false;

  button.appendChild(roninCanvas);
  root.appendChild(roninBubble);
  root.appendChild(button);
  document.body.appendChild(root);

  button.addEventListener('click', () => roninSay(roninNextLine()));

  drawRonin();
}

/**
 * Wake him up.
 *
 * Skipped entirely when the visitor has asked their operating system for
 * reduced motion: a character who breathes and blinks in the corner is exactly
 * the kind of decorative movement that setting exists to switch off. The rest
 * of the app still works identically without him.
 */
function setUpRonin() {
  /* typeof-checked rather than called directly. matchMedia is present in every
     browser this will realistically meet, but it is a capability query, and a
     purely decorative feature has no business throwing a TypeError and putting
     an uncaught error in the console if the query itself is unavailable. */
  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) return;

  /* Only start the idle timers if he actually got built. Starting them anyway
     would mean a timer firing every second into a canvas that does not exist. */
  if (buildRonin() === false) return;

  startRoninBreathing();
  scheduleRoninBlink();
}

/* Same contract every page script follows: do nothing at all while the auth
   guard is sending this visitor somewhere else. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', setUpRonin);
}
