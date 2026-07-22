/**
 * assistant.js — RONIN, the pixel samurai.
 *
 * A cyberpunk ronin who walks into the corner when a page loads, stands
 * watching, draws his sword when something happens, and gives a tip about the
 * page you are on when clicked.
 *
 * HOW THE ANIMATION WORKS
 * The art is one 512x512 sprite sheet, `assets/ronin.png`. A sheet is a single
 * image holding every frame of every animation side by side, and drawing one
 * frame means copying a rectangle out of it — that is exactly what the nine
 * argument form of drawImage does:
 *
 *     drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)
 *                     \__source____/  \_destination_/
 *
 * One image request covers every frame, and switching animation is switching
 * which list of rectangles the loop walks.
 *
 * The rectangles below were not measured by eye. A tool decoded the PNG,
 * scanned the alpha channel for fully transparent rows and columns — the
 * gutters between sprites — and reported the bounding box of everything
 * between them. Every frame then got a source rectangle of the SAME size,
 * centred on its bounding box and aligned to its bottom edge, so the character
 * keeps his feet on the ground and does not change size or jitter between
 * animations.
 *
 * Loaded after ui.js, whose showToast announces the events he reacts to.
 */

const RONIN_SHEET_SRC = 'assets/ronin.png';

/*
  The one page he stands on.

  He was on all four protected pages to begin with. He is fixed to the
  bottom-left corner, and on Clients, Analytics and Profile that corner is
  occupied — a client card, the findings terminal, the danger zone — so he
  overlapped real content and, because his button accepts clicks, took clicks
  that were meant for whatever was underneath him. Making him smaller or
  moving him would only pick a different thing to sit on, since every one of
  those pages fills its width. The dashboard is the page with room.
*/
const RONIN_PAGE = 'dashboard';

/* Every frame is cut from the sheet at this size. Chosen as the largest
   bounding box across all the frames used, plus a little margin. */
const RONIN_FRAME_W = 100;
const RONIN_FRAME_H = 116;

/* Frame durations. The walk is the slowest thing here on purpose — a six
   frame cycle played fast reads as a panic rather than a patrol. */
const RONIN_WALK_MS = 110;
const RONIN_ATTACK_MS = 80;
const RONIN_BREATH_MS = 1400;

/* How far he walks in from, and how long the entrance takes. */
const RONIN_ENTRANCE_PX = 160;
const RONIN_ENTRANCE_MS = 1400;

/* Speech. */
const RONIN_TYPE_MS = 26;
const RONIN_BUBBLE_MS = 7000;

/*
  The frames, as offsets into the sheet.

  Two are nudged off perfect centring because the sprite sits too close to the
  edge of the sheet for a 100px cell to be centred on it:

    walk[0]  wants sx -4  -> clamped to 0
    walk[5]  wants sx 414 -> clamped to 412, since 414 + 100 is 514 and the
             sheet is only 512 wide

  Both are off centre by a few pixels in a single frame of a six frame cycle,
  which is invisible in motion. Sampling outside the image is not invisible:
  the browser clips the source rectangle and then stretches what is left to
  fill the destination, so the character would visibly squash on that frame.
  The second one was caught by a test asserting every source rectangle stays
  inside the sheet.
*/
const RONIN_SHEET_SIZE = 512;

const RONIN_ANIMATIONS = {
  idle: [
    { sx: 408, sy: 132 },
  ],
  walk: [
    { sx: 0, sy: 4 },
    { sx: 78, sy: 4 },
    { sx: 160, sy: 4 },
    { sx: 246, sy: 4 },
    { sx: 330, sy: 4 },
    { sx: 412, sy: 4 },
  ],
  attack: [
    { sx: 2, sy: 380 },
    { sx: 108, sy: 380 },
    { sx: 202, sy: 380 },
    { sx: 302, sy: 380 },
    { sx: 402, sy: 380 },
  ],
};

/* ==================================================================
   What he says
   ================================================================== */

const RONIN_LINES = [
  'Four numbers, one truth. Won revenue counts closed deals only.',
  'The clock is live. Everything else is counted from your client list.',
  'Pipeline looking thin? Head to Clients and move something forward.',
  'Numbers here are today. The Analytics board tells you what is wrong.',
  'A deal nobody has touched in two weeks is already half lost.',
  'If one client is most of your revenue, that is not success. That is risk.',
  'On the Clients page, press / to search and ? for every shortcut.',
  'Thirty souls came in from the wire. The rest are yours.',
];

/* Short reactions, said when something happens rather than when clicked. */
const RONIN_REACTIONS = {
  success: ['Clean cut.', 'Done.', 'Filed.', 'Another one handled.'],
  error: ['That did not land.', 'Something is wrong.', 'Try that again.'],
  info: ['Noted.', 'Understood.'],
};

/* ==================================================================
   State
   ================================================================== */

let roninSheet = null;
let roninCanvas = null;
let roninCtx = null;
let roninRoot = null;
let roninBubble = null;

let roninAnimation = 'idle';
let roninFrameIndex = 0;
let roninFrameTimer = null;
let roninBreath = 0;
let roninBreathTimer = null;

let roninTypeTimer = null;
let roninHideTimer = null;
let roninLastLine = '';

/* ==================================================================
   Drawing
   ================================================================== */

/**
 * Paint the current frame.
 *
 * clearRect first, because a canvas draws on top of whatever was there rather
 * than replacing it — without it every frame would smear over the last.
 */
function drawRonin() {
  if (!roninCtx || !roninSheet) return;

  const frames = RONIN_ANIMATIONS[roninAnimation];
  const frame = frames[roninFrameIndex % frames.length];

  roninCtx.clearRect(0, 0, roninCanvas.width, roninCanvas.height);

  roninCtx.drawImage(
    roninSheet,
    frame.sx, frame.sy, RONIN_FRAME_W, RONIN_FRAME_H,   // source rectangle
    0, roninBreath, RONIN_FRAME_W, RONIN_FRAME_H        // where to put it
  );
}

/* ==================================================================
   Animation control
   ================================================================== */

/**
 * Switch animation.
 *
 * `loop: false` plays the sequence once and then falls back to idle, which is
 * what an attack should do — a sword swing that repeats forever is a windmill.
 *
 * The previous frame timer is always cleared first. Without that, two
 * animations started in quick succession would leave two intervals advancing
 * the same frame counter and the sprite would flicker between sequences.
 */
function playRonin(name, { loop = true, speed = RONIN_WALK_MS } = {}) {
  clearInterval(roninFrameTimer);

  roninAnimation = name;
  roninFrameIndex = 0;
  drawRonin();

  const frames = RONIN_ANIMATIONS[name];
  if (frames.length <= 1) return;   // a single-frame pose needs no timer

  roninFrameTimer = setInterval(() => {
    roninFrameIndex += 1;

    if (!loop && roninFrameIndex >= frames.length) {
      clearInterval(roninFrameTimer);
      playRonin('idle');
      return;
    }

    drawRonin();
  }, speed);
}

/** A single sword swing, then back to standing. */
function roninAttack() {
  playRonin('attack', { loop: false, speed: RONIN_ATTACK_MS });
}

/**
 * Walk in from off to the left, then settle.
 *
 * The walk cycle animates the sprite; the CSS transition slides the whole
 * element across. Neither alone would read as walking — feet moving on the
 * spot, or a figure gliding sideways in a fixed pose.
 */
function roninEntrance() {
  playRonin('walk', { speed: RONIN_WALK_MS });

  roninRoot.style.transform = `translateX(${-RONIN_ENTRANCE_PX}px)`;
  roninRoot.style.opacity = '0';

  /* Next frame, so the browser registers the starting position before the
     transition begins. Setting both values in the same frame would jump. */
  requestAnimationFrame(() => {
    roninRoot.style.transition =
      `transform ${RONIN_ENTRANCE_MS}ms linear, opacity 400ms ease-out`;
    roninRoot.style.transform = 'translateX(0)';
    roninRoot.style.opacity = '1';
  });

  setTimeout(() => playRonin('idle'), RONIN_ENTRANCE_MS);
}

/** A one pixel vertical shift, alternating. Cheap, and enough to look alive. */
function startRoninBreathing() {
  roninBreathTimer = setInterval(() => {
    roninBreath = roninBreath === 0 ? 1 : 0;
    if (roninAnimation === 'idle') drawRonin();
  }, RONIN_BREATH_MS);
}

/* ==================================================================
   Speech
   ================================================================== */

/**
 * Say something, one character at a time.
 *
 * Any line still being typed is cancelled first, so clicking twice quickly
 * does not leave two intervals writing into the same element. textContent
 * rather than innerHTML, for the same reason as everywhere else in this app.
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

/** A tip, never the same one twice running. */
function roninNextLine() {
  if (RONIN_LINES.length === 1) return RONIN_LINES[0];

  let pick = roninLastLine;
  while (pick === roninLastLine) {
    pick = RONIN_LINES[Math.floor(Math.random() * RONIN_LINES.length)];
  }
  roninLastLine = pick;
  return pick;
}

/* ==================================================================
   Reacting to the app
   ================================================================== */

/**
 * React when the app announces something.
 *
 * ui.js dispatches a `crm:toast` event every time it shows a notification, and
 * RONIN listens for it. Going through an event rather than calling him
 * directly keeps the two apart: clients.js and profile.js know nothing about
 * him, he knows nothing about them, and deleting this whole file would leave
 * the rest of the app working exactly as before.
 */
function handleRoninEvent(event) {
  const type = event.detail?.type || 'info';

  /* A success is worth drawing the sword for. Anything else just gets a word. */
  if (type === 'success') roninAttack();

  const lines = RONIN_REACTIONS[type] || RONIN_REACTIONS.info;
  roninSay(lines[Math.floor(Math.random() * lines.length)]);
}

/* ==================================================================
   Build
   ================================================================== */

function buildRonin() {
  roninRoot = document.createElement('div');
  roninRoot.className = 'ronin';

  roninBubble = document.createElement('div');
  roninBubble.className = 'ronin__bubble';
  roninBubble.hidden = true;
  roninBubble.setAttribute('role', 'status');
  roninBubble.setAttribute('aria-live', 'polite');

  /* A real <button>, so he is keyboard reachable and announces himself. The
     canvas inside is decorative. */
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ronin__btn';
  button.setAttribute('aria-label', 'RONIN, your assistant. Activate for a tip.');

  roninCanvas = document.createElement('canvas');
  roninCanvas.className = 'ronin__canvas';
  roninCanvas.width = RONIN_FRAME_W;
  /* One spare pixel of height for the breathing shift, so it cannot clip his
     boots off at the bottom of the canvas. */
  roninCanvas.height = RONIN_FRAME_H + 1;
  roninCanvas.setAttribute('aria-hidden', 'true');

  roninCtx = roninCanvas.getContext('2d');

  /* No 2-D context: some privacy modes block canvas entirely, and a headless
     environment may have no backend. He is decoration, so leave quietly rather
     than throw and take the page's other scripts down. */
  if (!roninCtx) return false;

  /* The sheet is pixel art. Without this the browser smooths it when scaling
     and every hard edge turns to mush. */
  roninCtx.imageSmoothingEnabled = false;

  button.appendChild(roninCanvas);
  roninRoot.appendChild(roninBubble);
  roninRoot.appendChild(button);
  document.body.appendChild(roninRoot);

  button.addEventListener('click', () => {
    roninAttack();
    roninSay(roninNextLine());
  });

  document.addEventListener('crm:toast', handleRoninEvent);

  return true;
}

/**
 * Wake him up once the sheet has arrived.
 *
 * Nothing can be drawn until the image has finished loading — a canvas asked
 * to draw an incomplete image silently draws nothing. So the whole character
 * waits on the load event rather than assuming the file is ready.
 *
 * If the sheet fails to load he is removed entirely rather than left as an
 * empty box, and the app carries on without him.
 */
function setUpRonin() {
  /* Belt and braces with the script tags: only dashboard.html loads this file,
     and if that ever changes by accident he still will not appear anywhere
     else. One named constant is cheaper than finding out later why a sprite is
     sitting on top of the client list again. */
  if (currentPage !== RONIN_PAGE) return;

  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A character who walks, breathes and swings a sword is exactly the kind of
     decorative movement this setting exists to switch off. */
  if (prefersReducedMotion) return;

  if (buildRonin() === false) return;

  roninSheet = new Image();

  roninSheet.onload = () => {
    roninEntrance();
    startRoninBreathing();
  };

  roninSheet.onerror = () => {
    console.warn('RONIN: sprite sheet could not be loaded; continuing without him.');
    roninRoot.remove();
    roninRoot = null;
  };

  roninSheet.src = RONIN_SHEET_SRC;
}

/* Same contract as every page script: do nothing at all while the auth guard
   is sending this visitor somewhere else. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', setUpRonin);
}
