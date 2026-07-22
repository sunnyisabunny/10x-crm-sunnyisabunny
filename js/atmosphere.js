/**
 * atmosphere.js — the digital rain behind every page.
 *
 * The first attempt at this was pure CSS: thin vertical gradients scrolling
 * downwards. It moved, but it had no characters in it, so it read as stripes
 * rather than as falling code. Real rain needs individual glyphs that change
 * as they fall, and CSS cannot draw text it was not given.
 *
 * So this is a canvas. One column per glyph-width across the viewport, each
 * with its own head position and speed. Every frame each column draws one new
 * character at its head and moves down; older characters are left behind and
 * faded out, which is what produces the trailing tail.
 *
 * THE TRICK THAT MAKES IT WORK ON A TRANSPARENT BACKGROUND
 * The usual way to fade the tail is to paint a low-alpha black rectangle over
 * the whole canvas each frame. That would work, but it would also make the
 * canvas opaque and hide the haze and grid this app draws behind it. Instead
 * the fade uses globalCompositeOperation = 'destination-out', which subtracts
 * alpha rather than adding colour — so old glyphs fade towards transparent
 * instead of towards black, and everything behind the canvas stays visible.
 *
 * Loaded on all five pages, after app.js.
 */

/* Column width and glyph size in CSS pixels. */
const RAIN_FONT_SIZE = 16;

/* How much alpha is removed from the whole canvas each frame. Higher means
   shorter tails. Lowered along with the speed below: a slower column covers
   less ground before its trail fades, so keeping the old fade rate would have
   left short stubs instead of long streaks. */
const RAIN_FADE = 0.032;

/* Rows advanced per frame. At roughly 60 frames a second and a 16px row, the
   range below works out at about 100-300 pixels a second — a drift rather
   than a downpour. The spread between the two is what matters most: columns
   moving at visibly different speeds is what stops the field reading as one
   solid block sliding down the screen. */
const RAIN_MIN_SPEED = 0.10;
const RAIN_MAX_SPEED = 0.30;

/* Chance per frame that a column that has run off the bottom restarts. Low, so
   columns come back staggered rather than all at once. */
const RAIN_RESPAWN_CHANCE = 0.02;

/* How faint the whole layer is. The interface has to stay readable on top of
   it, and this is the single number that decides whether it does. */
const RAIN_OPACITY = 0.28;

/*
  Half-width katakana, digits and a few latin characters — the alphabet the
  film used. They are drawn as-is; no font tricks and no mirroring, because a
  reversed glyph is only recognisable to someone reading Japanese and the
  effect does not depend on it.
*/
const RAIN_GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFZ:.=*+-<>¦';

let rainCanvas = null;
let rainCtx = null;
let rainColumns = [];
let rainRatio = 1;

/** One random character from the alphabet. */
function rainGlyph() {
  return RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)];
}

/**
 * Size the canvas to the window, in real device pixels.
 *
 * A canvas has two sizes: how many pixels it contains (width/height) and how
 * big it is on screen (CSS). On a high-density display those differ, and
 * setting only the CSS size gives blurry text. Multiplying by devicePixelRatio
 * and scaling the context keeps the glyphs sharp.
 *
 * Rebuilding the column list here is deliberate: a resized window needs a
 * different number of columns, and rebuilding is simpler and less error-prone
 * than trying to add or remove them individually.
 */
function sizeRain() {
  rainRatio = window.devicePixelRatio || 1;

  rainCanvas.width = Math.floor(window.innerWidth * rainRatio);
  rainCanvas.height = Math.floor(window.innerHeight * rainRatio);
  rainCanvas.style.width = `${window.innerWidth}px`;
  rainCanvas.style.height = `${window.innerHeight}px`;

  rainCtx.setTransform(rainRatio, 0, 0, rainRatio, 0, 0);
  rainCtx.font = `${RAIN_FONT_SIZE}px ${getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace'}`;
  rainCtx.textBaseline = 'top';

  const count = Math.ceil(window.innerWidth / RAIN_FONT_SIZE);
  rainColumns = [];

  for (let i = 0; i < count; i += 1) {
    rainColumns.push({
      /* Start scattered above the fold so the field is already falling when
         the page appears, rather than every column starting from the top. */
      y: Math.random() * -60,
      speed: RAIN_MIN_SPEED + Math.random() * (RAIN_MAX_SPEED - RAIN_MIN_SPEED),
    });
  }
}

/** The colour the rain is currently falling in, read live from the theme. */
function rainColor() {
  return getComputedStyle(document.body).getPropertyValue('--phosphor').trim() || '#39FF14';
}

/**
 * Draw one frame.
 *
 * Three passes, and the order matters:
 *   1. subtract alpha everywhere, ageing every glyph already on the canvas
 *   2. draw each column's newest glyph in a bright, near-white head colour
 *   3. draw it again in the phosphor colour just behind the head, so the
 *      trail is green while the leading character reads as white-hot
 */
function drawRain() {
  const height = window.innerHeight;
  const color = rainColor();

  /* 1. Age everything by removing alpha rather than painting over it. */
  rainCtx.globalCompositeOperation = 'destination-out';
  rainCtx.fillStyle = `rgba(0, 0, 0, ${RAIN_FADE})`;
  rainCtx.fillRect(0, 0, window.innerWidth, height);

  /* Back to normal painting for the glyphs. */
  rainCtx.globalCompositeOperation = 'source-over';

  for (let i = 0; i < rainColumns.length; i += 1) {
    const column = rainColumns[i];
    const x = i * RAIN_FONT_SIZE;
    const y = column.y * RAIN_FONT_SIZE;

    if (y > 0 && y < height) {
      /* 2. The head: brighter and desaturated, so it reads as the leading
            edge rather than as one more character in the trail. */
      rainCtx.fillStyle = '#DFFFE8';
      rainCtx.fillText(rainGlyph(), x, y);

      /* 3. The character just above it, in full phosphor. */
      rainCtx.fillStyle = color;
      rainCtx.fillText(rainGlyph(), x, y - RAIN_FONT_SIZE);
    }

    column.y += column.speed;

    /* Once a column is off the bottom it waits a random while before falling
       again, which keeps the field irregular instead of pulsing in unison. */
    if (y > height && Math.random() < RAIN_RESPAWN_CHANCE) {
      column.y = Math.random() * -20;
      column.speed = RAIN_MIN_SPEED + Math.random() * (RAIN_MAX_SPEED - RAIN_MIN_SPEED);
    }
  }
}

let rainFrame = null;

function rainLoop() {
  drawRain();
  rainFrame = requestAnimationFrame(rainLoop);
}

/**
 * Stop drawing while the tab is in the background.
 *
 * requestAnimationFrame already throttles heavily when a tab is hidden, but
 * cancelling outright means a backgrounded tab does no work at all. This is
 * the one animation in the app that runs continuously, so it is the one worth
 * being careful about.
 */
function handleRainVisibility() {
  if (document.hidden) {
    cancelAnimationFrame(rainFrame);
    rainFrame = null;
  } else if (rainFrame === null) {
    rainLoop();
  }
}

function setUpRain() {
  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Falling text across the whole screen is exactly the kind of continuous
     movement this setting exists to switch off. */
  if (prefersReducedMotion) return false;

  rainCanvas = document.createElement('canvas');
  rainCanvas.className = 'rain';
  rainCanvas.setAttribute('aria-hidden', 'true');

  rainCtx = rainCanvas.getContext('2d');

  /* No 2-D backend available: this is decoration, so leave quietly rather
     than throw and take the page's other scripts down. */
  if (!rainCtx) return false;

  rainCanvas.style.opacity = String(RAIN_OPACITY);
  document.body.appendChild(rainCanvas);

  sizeRain();
  window.addEventListener('resize', sizeRain);
  document.addEventListener('visibilitychange', handleRainVisibility);
  rainLoop();

  return true;
}

/* Same contract as every other page script: stay out of the way entirely if
   the auth guard is already sending this visitor somewhere else. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', setUpRain);
}
