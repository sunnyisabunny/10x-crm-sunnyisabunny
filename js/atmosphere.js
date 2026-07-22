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
 * Loaded on all six pages, after app.js.
 */

/* Column width and glyph size in CSS pixels. Raised from 16: at 16 the glyphs
   were legible in principle and unreadable in practice, because half-width
   katakana at that size behind a translucent interface is mostly noise. */
const RAIN_FONT_SIZE = 20;

/* How much alpha is removed from the whole canvas each frame. Higher means
   shorter tails. Now that a glyph is painted once and then left alone (see
   drawRain), this number alone decides how long a trail survives: at 0.012 a
   character keeps roughly a tenth of its brightness after 200 frames, which
   is about three seconds of tail. */
const RAIN_FADE = 0.012;

/* Rows advanced per frame. At roughly 60 frames a second and a 20px row this
   is about 60-190 pixels a second, or one new character every quarter second
   in the slowest columns. The spread between the two matters more than either
   number: columns moving at visibly different speeds is what stops the field
   reading as one solid block sliding down the screen. */
const RAIN_MIN_SPEED = 0.05;
const RAIN_MAX_SPEED = 0.16;

/* Chance per row-step that a column which has run off the bottom restarts.
   Checked per step rather than per frame, so it does not need to be tiny. */
const RAIN_RESPAWN_CHANCE = 0.08;

/* How faint the whole layer is. The interface has to stay readable on top of
   it, and this is the single number that decides whether it does. */
const RAIN_OPACITY = 0.32;

/* The leading character of a column, drawn near-white so it reads as the
   bright head of the streak rather than one more glyph in the trail. */
const RAIN_HEAD_COLOR = '#E8FFF0';

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
  const rows = Math.ceil(window.innerHeight / RAIN_FONT_SIZE);
  rainColumns = [];

  for (let i = 0; i < count; i += 1) {
    rainColumns.push(newRainColumn(Math.random() * (rows + 10) - 10));
  }
}

/**
 * One falling column.
 *
 * `y` is measured in rows, not pixels, because the whole point of the redraw
 * below is that a glyph is only ever painted on a whole row. `row` remembers
 * which row was last painted and `glyph` remembers what was painted there, so
 * the head can be repainted in the trail colour when it moves on.
 */
function newRainColumn(startRow) {
  return {
    y: startRow,
    row: Math.floor(startRow),
    glyph: '',
    speed: RAIN_MIN_SPEED + Math.random() * (RAIN_MAX_SPEED - RAIN_MIN_SPEED),
  };
}

/** The colour the rain is currently falling in, read live from the theme. */
function rainColor() {
  return getComputedStyle(document.body).getPropertyValue('--phosphor').trim() || '#39FF14';
}

/**
 * Draw one frame.
 *
 * WHY A GLYPH IS ONLY EVER PAINTED ONCE
 * The first version of this drew a fresh random character at the head of every
 * column on every frame. A column moves less than a fifth of a row per frame,
 * so the head stays on the same row for five to twenty frames — and each of
 * those frames stamped a DIFFERENT random character on the same spot. What
 * ended up on screen was five characters overlapping in the same 20 pixels,
 * which is why the rain looked like flickering static however far it was
 * slowed down. Slowing it further made it worse, not better: a slower column
 * spends longer on each row, so it piles up more characters per position.
 *
 * The fix is to move drawing off the frame clock and onto the row. A column
 * only paints when it crosses into a new row, which means every character is
 * stamped exactly once, in one place, and then simply fades. The two are now
 * independent: speed changes how often a new character appears, and RAIN_FADE
 * changes how long it lingers.
 *
 * Each step does three things, in this order:
 *   1. subtract alpha everywhere, ageing every glyph already on the canvas
 *   2. repaint the previous head in the trail colour, demoting it
 *   3. paint the new head in near-white
 */
function drawRain() {
  const rows = Math.ceil(window.innerHeight / RAIN_FONT_SIZE);
  const color = rainColor();

  /* 1. Age everything by removing alpha rather than painting over it. */
  rainCtx.globalCompositeOperation = 'destination-out';
  rainCtx.fillStyle = `rgba(0, 0, 0, ${RAIN_FADE})`;
  rainCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  /* Back to normal painting for the glyphs. */
  rainCtx.globalCompositeOperation = 'source-over';

  for (let i = 0; i < rainColumns.length; i += 1) {
    const column = rainColumns[i];
    column.y += column.speed;

    const row = Math.floor(column.y);
    if (row === column.row) continue;   // still on the same row; nothing to draw

    const x = i * RAIN_FONT_SIZE;

    /* 2. The character that was the head is now one place behind it, so it is
          repainted in phosphor. Same glyph, same spot, so the green covers the
          white exactly — which is why the glyph had to be remembered. */
    if (column.glyph && column.row >= 0 && column.row < rows) {
      rainCtx.fillStyle = color;
      rainCtx.fillText(column.glyph, x, column.row * RAIN_FONT_SIZE);
    }

    column.row = row;
    column.glyph = rainGlyph();

    /* 3. The new head. Rows above the top and below the bottom are skipped:
          the column keeps counting either way, so a column runs off the
          bottom and falls quietly until it is restarted. */
    if (row >= 0 && row < rows) {
      rainCtx.fillStyle = RAIN_HEAD_COLOR;
      rainCtx.fillText(column.glyph, x, row * RAIN_FONT_SIZE);
    }

    /* Once a column is off the bottom it waits a random while before falling
       again, which keeps the field irregular instead of pulsing in unison. */
    if (row > rows && Math.random() < RAIN_RESPAWN_CHANCE) {
      rainColumns[i] = newRainColumn(Math.random() * -20);
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
