/**
 * atmosphere.js — the canvas that sits behind every page.
 *
 * ONE CANVAS, TWO ATMOSPHERES.
 *
 * The two themes in this app are not the same design recoloured, so they do
 * not get the same background. Dark is "Cyber Chrome": neon on near-black,
 * and it rains code. Light is "Soft Club, Haunted": a cold, drained,
 * late-nineties frosted interface standing in a fogbank, with things pressing
 * through the fog from behind it.
 *
 * Both are painted by this file, onto the same fixed full-screen canvas at
 * z-index -1, and the painter is swapped when the theme changes. Everything
 * that is genuinely shared — sizing the canvas for the display, pausing in a
 * background tab, honouring reduced motion, reading colours out of the theme —
 * is written once and used by both.
 *
 * WHY A CANVAS AT ALL
 * The rain started as pure CSS: thin vertical gradients scrolling downwards.
 * It moved, but it had no characters in it, so it read as stripes rather than
 * as falling code. Real rain needs individual glyphs that change as they fall,
 * and CSS cannot draw text it was never given. The same argument applies twice
 * over to the apparitions: CSS has no way to draw a hand.
 *
 * Loaded on all six pages, after app.js.
 */

/* ============================================================
   SHARED
   ============================================================ */

/* Frames per second for the whole canvas.
 *
 * Neither atmosphere is fast: the rain advances at most a fifth of a row per
 * frame and the fog takes half a minute to cross the screen. At 60fps every
 * second frame was therefore near-identical to the one before it — real work
 * for no visible difference. Halving the rate halves the cost of the only
 * thing in this app that runs continuously, and nothing about it looks
 * different. */
const ATMOS_FPS = 30;

/* Ceiling on the pixel density the canvas is drawn at.
 *
 * A canvas has two sizes: how many pixels it contains and how big it is on
 * screen. Matching a 3x phone display exactly means drawing NINE times the
 * pixels of a 1x one, every frame, forever — for decoration nobody is meant
 * to look at directly. 1.5 is enough that no edge looks obviously chunky and
 * it caps the worst case at a bit over double, rather than nine times. */
const ATMOS_MAX_RATIO = 1.5;

let atmosCanvas = null;
let atmosCtx = null;
let atmosRatio = 1;
let atmosTheme = 'dark';
let atmosFrame = null;
let atmosLastPaint = 0;

/* Colours read out of the active theme.
 *
 * These used to be read with getComputedStyle() inside the draw loop, which
 * meant the browser was asked to resolve the styles of the entire document
 * sixty times a second in order to look up one colour. Reading them once into
 * here, and again only when the theme actually changes, removes that entirely.
 * It was the single most expensive line in the file. */
const atmosColors = {
  phosphor: '#39FF14',
  fogFar: 'rgba(190, 199, 189, 0.55)',
  fogNear: 'rgba(214, 220, 212, 0.42)',
  apparition: '#5E6A62',
  mono: 'monospace',
};

/** Re-read every colour the painters need. One style resolution, not sixty. */
function readAtmosColors() {
  const style = getComputedStyle(document.body);
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;

  atmosColors.phosphor = pick('--phosphor', '#39FF14');
  atmosColors.fogFar = pick('--fog-far', 'rgba(190, 199, 189, 0.55)');
  atmosColors.fogNear = pick('--fog-near', 'rgba(214, 220, 212, 0.42)');
  atmosColors.apparition = pick('--apparition', '#5E6A62');
  atmosColors.mono = pick('--font-mono', 'monospace');
}

/**
 * Switch atmospheres.
 *
 * Called by applyTheme() in js/app.js whenever the theme changes. It is a
 * shared global rather than an event listener for the same reason
 * isRedirecting is: this project has no module system, and one named function
 * that another file calls directly is the thing a person can actually follow.
 * The typeof guard on the calling side means app.js does not care whether this
 * file was loaded at all.
 */
function syncAtmosphere() {
  if (!atmosCtx) return;

  atmosTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  readAtmosColors();

  /* Wipe whatever the previous atmosphere had painted. The rain in particular
     leaves a screen full of half-faded glyphs behind it, and they would sit
     there fossilised under the fog. */
  atmosCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  atmosCanvas.style.opacity = String(atmosTheme === 'light' ? lightOpacity() : RAIN_OPACITY);

  if (atmosTheme === 'light') {
    ensureApparitionSheet();
    resetHaunt();
  } else {
    resetRain();
  }
}

/**
 * Size the canvas to the window, in real device pixels.
 *
 * On a high-density display the CSS size and the pixel count differ, and
 * setting only the CSS size gives blurry output. Multiplying by the (capped)
 * device ratio and scaling the context keeps edges sharp.
 *
 * Both atmospheres rebuild their state here, because both are laid out
 * relative to the viewport and neither can be meaningfully stretched.
 */
function sizeAtmosphere() {
  atmosRatio = Math.min(window.devicePixelRatio || 1, ATMOS_MAX_RATIO);

  atmosCanvas.width = Math.floor(window.innerWidth * atmosRatio);
  atmosCanvas.height = Math.floor(window.innerHeight * atmosRatio);
  atmosCanvas.style.width = `${window.innerWidth}px`;
  atmosCanvas.style.height = `${window.innerHeight}px`;

  atmosCtx.setTransform(atmosRatio, 0, 0, atmosRatio, 0, 0);
  atmosCtx.textBaseline = 'top';

  resetRain();
  resetHaunt();
}

/* ============================================================
   ATMOSPHERE 1 — THE DIGITAL RAIN (dark theme)
   ============================================================ */

/* Column width and glyph size in CSS pixels. Raised from 16: at 16 the glyphs
   were legible in principle and unreadable in practice, because half-width
   katakana at that size behind a translucent interface is mostly noise. */
const RAIN_FONT_SIZE = 20;

/* How much alpha is removed from the whole canvas each frame. Higher means
   shorter tails. Now that a glyph is painted once and then left alone (see
   drawRain), this number alone decides how long a trail survives. It was
   raised with the frame rate cut, so that a tail still lasts about the same
   number of SECONDS as it did at sixty frames a second. */
const RAIN_FADE = 0.024;

/* Rows advanced per frame. The spread between the two matters more than
   either number: columns moving at visibly different speeds is what stops the
   field reading as one solid block sliding down the screen. Doubled alongside
   the frame-rate cut, so the rain falls at the same speed as before. */
const RAIN_MIN_SPEED = 0.10;
const RAIN_MAX_SPEED = 0.32;

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

let rainColumns = [];

/** One random character from the alphabet. */
function rainGlyph() {
  return RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)];
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

/** Rebuild the column list for the current viewport. */
function resetRain() {
  if (!atmosCtx) return;

  atmosCtx.font = `${RAIN_FONT_SIZE}px ${atmosColors.mono}`;

  const count = Math.ceil(window.innerWidth / RAIN_FONT_SIZE);
  const rows = Math.ceil(window.innerHeight / RAIN_FONT_SIZE);
  rainColumns = [];

  for (let i = 0; i < count; i += 1) {
    rainColumns.push(newRainColumn(Math.random() * (rows + 10) - 10));
  }
}

/**
 * Draw one frame of rain.
 *
 * WHY A GLYPH IS ONLY EVER PAINTED ONCE
 * The first version of this drew a fresh random character at the head of every
 * column on every frame. A column moves less than a fifth of a row per frame,
 * so the head stays on the same row for five to twenty frames — and each of
 * those frames stamped a DIFFERENT random character on the same spot. What
 * ended up on screen was five characters overlapping in the same 20 pixels,
 * which is why the rain looked like flickering static however far it was
 * slowed down. Slowing it further made it worse, not better.
 *
 * The fix is to move drawing off the frame clock and onto the row. A column
 * only paints when it crosses into a new row, which means every character is
 * stamped exactly once, in one place, and then simply fades.
 *
 * THE TRICK THAT MAKES IT WORK ON A TRANSPARENT BACKGROUND
 * The usual way to fade a tail is to paint a low-alpha black rectangle over
 * the canvas each frame. That would also make the canvas opaque and hide the
 * haze and grid drawn behind it. So the fade uses destination-out, which
 * subtracts alpha rather than adding colour: old glyphs fade towards
 * transparent instead of towards black.
 */
function drawRain() {
  const rows = Math.ceil(window.innerHeight / RAIN_FONT_SIZE);
  const color = atmosColors.phosphor;

  /* 1. Age everything by removing alpha rather than painting over it. */
  atmosCtx.globalCompositeOperation = 'destination-out';
  atmosCtx.fillStyle = `rgba(0, 0, 0, ${RAIN_FADE})`;
  atmosCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  /* Back to normal painting for the glyphs. */
  atmosCtx.globalCompositeOperation = 'source-over';

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
      atmosCtx.fillStyle = color;
      atmosCtx.fillText(column.glyph, x, column.row * RAIN_FONT_SIZE);
    }

    column.row = row;
    column.glyph = rainGlyph();

    /* 3. The new head. Rows above the top and below the bottom are skipped:
          the column keeps counting either way, so a column runs off the
          bottom and falls quietly until it is restarted. */
    if (row >= 0 && row < rows) {
      atmosCtx.fillStyle = RAIN_HEAD_COLOR;
      atmosCtx.fillText(column.glyph, x, row * RAIN_FONT_SIZE);
    }

    /* Once a column is off the bottom it waits a random while before falling
       again, which keeps the field irregular instead of pulsing in unison. */
    if (row > rows && Math.random() < RAIN_RESPAWN_CHANCE) {
      rainColumns[i] = newRainColumn(Math.random() * -20);
    }
  }
}

/* ============================================================
   ATMOSPHERE 2 — THE HAUNT (light theme)

   Three things happen on this canvas, back to front:

     far fog        slow banks, established first so there is depth
     the apparition rises out of the far fog, presses, recedes
     near fog       painted OVER it, so it never fully resolves

   That sandwich is the whole illusion. A figure drawn on top of fog is a
   sticker; a figure drawn INSIDE fog is something in the room.

   Handprints are deliberately not part of that cycle — they are their own
   slow layer, on their own clock, and nothing is ever shown making them.
   ============================================================ */

/* How faint the whole layer is. Raised from 0.5: at that level the figures
   were nearly invisible against the pale fog, which defeated the point of
   giving them real textures. The interface still has to stay readable over
   it, but the figures are placed clear of the content now (see hauntFreeSpot),
   so the layer can afford to be more present than it was. */
const HAUNT_OPACITY = 0.72;

/*
  THE APPARITION ATLAS.

  Built from assets/ghosts.png by scratchpad/extract-ghosts.mjs: eight
  sculpted faces, eight skeletal hands, eight bloody handprints, cut out of
  their concrete and packed into a uniform grid. Faces and hands were re-inked
  into a dark tonal range on the way through, because they are pale grey in
  the source and this theme's fog is pale too — drawn as they came they would
  have been invisible. Something approaching through fog reads as a darkening
  silhouette in any case.

  Indices are contiguous by kind, so picking "a random hand" is arithmetic
  rather than a lookup table.
*/
const APPARITION_SRC = 'assets/apparitions.png';
const APPARITION_CELL_W = 144;
const APPARITION_CELL_H = 184;
const APPARITION_COLS = 4;
const APPARITION_FACE_FIRST = 0;
const APPARITION_FACE_LAST = 7;
const APPARITION_HAND_FIRST = 8;
const APPARITION_HAND_LAST = 15;
const APPARITION_PRINT_FIRST = 16;
const APPARITION_PRINT_LAST = 23;

/* Fog banks. Five is enough never to look like a repeating pattern and few
   enough that the per-frame gradient work stays trivial. */
const FOG_COUNT = 5;

/* Seconds an apparition takes from first surfacing to gone. Shortened along
   with the gap below so the whole cycle turns over faster. */
const HAUNT_LIFE = 8;

/* Seconds of empty fog between apparitions, minimum and extra-random. Cut down
   so figures arrive noticeably more often — the room is more active than it
   was, while a little irregularity is kept so it never pulses in time. */
const HAUNT_GAP_MIN = 4;
const HAUNT_GAP_VAR = 7;

/* How far a slice can be pushed sideways, as a fraction of the figure's own
   width. Rendered across a range and looked at before it was chosen: below
   about 3% the figure stays symmetrical and reads as a sticker, and above
   about 11% a hand's fingers merge into each other. */
const HAUNT_WARP_FRAC = 0.07;

/* How many horizontal slices a figure is cut into. The stepping between
   slices is not a defect to be smoothed away — it is the same analog-tearing
   vocabulary as the scanlines, and it is what stops the warp reading as a
   soft liquid wobble. */
const HAUNT_SLICES = 26;

/* How tall a figure stands, as a fraction of the viewport.

   Deliberately modest. A figure at nearly full viewport height reads as a
   wallpaper photograph rather than as something in the room behind the
   interface, and at that size it cannot fit beside the content — so it ends up
   underneath a panel where nobody ever sees it. Smaller means it can stand in
   the gutter, in the open, where it is actually visible. */
const HAUNT_MIN_H = 0.22;
const HAUNT_VAR_H = 0.16;

/* ---- The handprint layer ----------------------------------------------
   Prints are not left BY anything. No hand precedes them and none follows.
   They simply fade up on empty glass, sit there, and fade out — which is
   more unpleasant than showing the cause, because there isn't one. They run
   on their own clock and the two layers never coordinate. */
const HAUNT_PRINT_LIFE = 18;
const HAUNT_PRINT_GAP_MIN = 6;
const HAUNT_PRINT_GAP_VAR = 10;

/* Prints are drawn at a fraction of viewport height, and never warped: a mark
   on the glass is on the glass, and wobbling it would say it was behind. */
const HAUNT_PRINT_MIN_H = 0.09;
const HAUNT_PRINT_VAR_H = 0.06;

/* Slightly below the figures' peak, but raised along with everything else on
   this pass so the blood actually reads as blood rather than a grey smudge. */
const HAUNT_PRINT_PEAK = 0.8;

/* BREACH — the light theme's easter egg.
 *
 * Where the dark theme's Konami code flips on a retro CRT, the light theme's
 * flips THIS: the haunting stops being ambient and comes through in force.
 * The canvas brightens, figures arrive almost on top of one another, and the
 * page darkens around them (the CSS half, in components.css). It is the same
 * shape of joke as CRT mode — an intensification of whatever that theme's
 * atmosphere already is — which is why the two share one trigger and split by
 * theme rather than being two separate codes to discover.
 *
 * app.js toggles it through setHauntBreach(); the flag then shortens every gap
 * and lifts the canvas opacity. */
let hauntBreach = false;
const BREACH_OPACITY = 0.95;
const BREACH_GAP_SCALE = 0.28;   // gaps shrink to a bit over a quarter

let apparitionSheet = null;
let apparitionReady = false;

let fogBanks = [];
let haunt = null;          // the apparition currently on screen, or null
let hauntNextAt = 0;       // seconds on the atmosphere clock until the next one
let hauntClock = 0;        // seconds since the haunt started running
let hauntPrint = null;     // the handprint currently on screen, or null
let hauntPrintNextAt = 0;

/**
 * Fetch the atlas, once, the first time the light theme is actually used.
 *
 * Not on page load: it is half a megabyte, and someone who never leaves the
 * dark theme should never pay for it. This is the same reasoning that took
 * the live blurs off thirty client cards earlier in this branch.
 */
function ensureApparitionSheet() {
  if (apparitionSheet) return;

  apparitionSheet = new Image();
  apparitionSheet.onload = () => { apparitionReady = true; };
  /* A missing atlas leaves the fog running on its own rather than throwing.
     The fog alone is still a complete background. */
  apparitionSheet.onerror = () => { apparitionReady = false; };
  apparitionSheet.src = APPARITION_SRC;
}

/** Fresh fog and an empty stage. */
function resetHaunt() {
  fogBanks = [];
  for (let i = 0; i < FOG_COUNT; i += 1) {
    fogBanks.push({
      x: Math.random(),                          // fractions of the viewport,
      y: Math.random(),                          // so a resize needs no fixing
      r: 0.28 + Math.random() * 0.34,
      vx: (Math.random() - 0.5) * 0.006,
      vy: (Math.random() - 0.5) * 0.003,
      near: i >= Math.floor(FOG_COUNT / 2),      // painted over the figure
    });
  }
  haunt = null;
  hauntPrint = null;
  hauntClock = 0;
  hauntNextAt = 1.5;      // the first figure arrives almost at once now
  hauntPrintNextAt = 4;   // the first print not long after, and unannounced
}

/** True while the user is being asked to read or decide something. */
function hauntBlocked() {
  return document.querySelector('.overlay:not([hidden])') !== null;
}

/** The light canvas opacity, breach or calm. */
function lightOpacity() {
  return hauntBreach ? BREACH_OPACITY : HAUNT_OPACITY;
}

/** How much every gap is scaled — everything comes faster during a breach. */
function gapScale() {
  return hauntBreach ? BREACH_GAP_SCALE : 1;
}

/**
 * Toggle the breach. Called by the Konami handler in app.js when the theme is
 * light. A shared global, guarded by typeof on the calling side, exactly like
 * syncAtmosphere and isRedirecting.
 */
function setHauntBreach(on) {
  hauntBreach = !!on;
  if (atmosCanvas && atmosTheme === 'light') {
    atmosCanvas.style.opacity = String(lightOpacity());
    /* Bring the next arrivals forward at once, so turning it on has an
       immediate answer rather than waiting out the gap already scheduled. */
    if (on) {
      hauntNextAt = Math.min(hauntNextAt, hauntClock + 0.5);
      hauntPrintNextAt = Math.min(hauntPrintNextAt, hauntClock + 1.5);
    }
  }
}

/**
 * Find somewhere the interface is not.
 *
 * The first version of this just pushed figures towards the left and right
 * quarters of the viewport, which sounds equivalent and is not: the content
 * column is centred and capped at --shell-max, so on a wide screen "the
 * quarter" is still partly under the panels and on a narrow one it is entirely
 * under them. Most apparitions were therefore spending their whole life behind
 * a client card, which is a lot of machinery for something nobody can see.
 *
 * Placement is random across the whole viewport now, rather than confined to
 * the gutters beside the content. That is a deliberate change: the figures are
 * brighter and arrive more often, and every one of them still passes BEHIND a
 * frosted panel, where the panel's own backdrop-blur softens it — so a figure
 * that lands over the content column is not a legibility problem, it is the
 * intended "seen through the glass" effect. What is still avoided is only the
 * two places a figure would genuinely be in the way: the taskbar strip at the
 * very top, and the bottom-left corner where the assistant stands.
 *
 * Nothing here is measured off the layout, so it costs nothing at spawn.
 */
function hauntFreeSpot(w, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  /* Anywhere from a little off the left edge to a little off the right, so a
     figure can sit fully on screen or half-enter from either side. */
  const x = -w * 0.2 + Math.random() * (vw - w * 0.6);

  /* Clear of the taskbar at the top. */
  const top = vh * 0.08;
  const bottom = Math.max(top, vh * 0.9 - h);
  let y = top + Math.random() * (bottom - top);

  /* Keep out of the assistant's bottom-left corner. If a random spot lands
     there, lift it just clear rather than re-rolling — one nudge, no loop. */
  const nearAssistant = x < 240 && y + h > vh - 200;
  if (nearAssistant) y = Math.max(top, vh - 200 - h);

  return { x, y };
}

/**
 * Choose the next apparition and where it stands.
 *
 * Faces and hands only — prints are not apparitions and are never spawned
 * here.
 */
function spawnApparition() {
  /* A modal exists because the user is being asked to act, and the whole app
     is dimmed behind it. Checked here, once, rather than in the draw loop: a
     DOM query per frame is exactly what this file was cleaned of. */
  if (hauntBlocked()) {
    hauntNextAt = hauntClock + 4;
    return;
  }

  const index = APPARITION_FACE_FIRST
    + Math.floor(Math.random() * (APPARITION_HAND_LAST - APPARITION_FACE_FIRST + 1));

  const height = window.innerHeight * (HAUNT_MIN_H + Math.random() * HAUNT_VAR_H);
  const scale = height / APPARITION_CELL_H;
  const width = APPARITION_CELL_W * scale;
  const spot = hauntFreeSpot(width, height);

  haunt = {
    index,
    scale,
    w: width,
    h: height,
    x: spot.x,
    y: spot.y,
    flip: Math.random() < 0.5,
    phase: Math.random() * Math.PI * 2,
    born: hauntClock,
  };
}

/** Choose the next handprint. Same placement rule, its own clock. */
function spawnHandprint() {
  if (hauntBlocked()) {
    hauntPrintNextAt = hauntClock + 8;
    return;
  }

  const index = APPARITION_PRINT_FIRST
    + Math.floor(Math.random() * (APPARITION_PRINT_LAST - APPARITION_PRINT_FIRST + 1));

  const height = window.innerHeight * (HAUNT_PRINT_MIN_H + Math.random() * HAUNT_PRINT_VAR_H);
  const scale = height / APPARITION_CELL_H;
  const width = APPARITION_CELL_W * scale;
  const spot = hauntFreeSpot(width, height);

  hauntPrint = {
    index,
    w: width,
    h: height,
    x: spot.x,
    y: spot.y,
    flip: Math.random() < 0.5,
    /* A hand landing on glass is never perfectly square to it. */
    tilt: (Math.random() - 0.5) * 0.5,
    born: hauntClock,
  };
}

/**
 * How present the apparition is, from 0 to 1, across its life.
 *
 * Four movements: rise slowly out of the fog, hold, press forward briefly,
 * then withdraw. The press is short and is the only moment it is fully
 * visible — everything else is approach and retreat, which is where the
 * unease actually lives.
 */
function hauntPresence(p) {
  if (p < 0.24) return (p / 0.24) * 0.78;                     // rising
  if (p < 0.55) return 0.78;                                  // holding
  if (p < 0.70) return 0.78 + ((p - 0.55) / 0.15) * 0.22;     // pressing
  return Math.max(0, 1 - (p - 0.70) / 0.30);                  // withdrawing
}

/** A print fades up, sits, and fades away. No press, no retreat. */
function printPresence(p) {
  if (p < 0.12) return (p / 0.12) * HAUNT_PRINT_PEAK;
  if (p < 0.72) return HAUNT_PRINT_PEAK;
  return HAUNT_PRINT_PEAK * Math.max(0, 1 - (p - 0.72) / 0.28);
}

/**
 * The membrane warp: how far a given slice is pushed sideways.
 *
 * Two sine waves of different wavelengths travelling down the figure, rather
 * than one. A single wave gives a clean S-bend that reads as a cartoon
 * wobble; adding a shorter, weaker second wave breaks the symmetry and is
 * what makes it look like a surface being deformed by something behind it.
 */
function hauntWarpAt(unit, phase, amount) {
  return (
    Math.sin(unit * Math.PI * 2.2 + phase) * amount
    + Math.sin(unit * Math.PI * 5.7 + phase * 1.7) * amount * 0.35
  );
}

/** Where a sprite index sits in the atlas. */
function apparitionCell(index) {
  return {
    sx: (index % APPARITION_COLS) * APPARITION_CELL_W,
    sy: Math.floor(index / APPARITION_COLS) * APPARITION_CELL_H,
  };
}

/** Paint the fog banks whose `near` flag matches. */
function drawFog(near) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const color = near ? atmosColors.fogNear : atmosColors.fogFar;
  const span = Math.max(w, h);

  for (const bank of fogBanks) {
    if (bank.near !== near) continue;

    const cx = bank.x * w;
    const cy = bank.y * h;
    const r = bank.r * span;

    const gradient = atmosCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'transparent');
    atmosCtx.fillStyle = gradient;
    atmosCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

/** Drift the fog. Banks wrap around rather than turning back, so the field
    never settles into a visible oscillation. */
function moveFog(dt) {
  for (const bank of fogBanks) {
    bank.x += bank.vx * dt;
    bank.y += bank.vy * dt;
    if (bank.x < -0.6) bank.x = 1.6;
    if (bank.x > 1.6) bank.x = -0.6;
    if (bank.y < -0.6) bank.y = 1.6;
    if (bank.y > 1.6) bank.y = -0.6;
  }
}

/**
 * Draw the apparition, warped, in horizontal slices.
 *
 * Each slice is a strip of the atlas cell blitted at its own horizontal
 * offset. Nothing is allocated and nothing is pre-rendered: a strip copy
 * straight out of the loaded image is about as cheap as canvas work gets,
 * which matters because this runs behind every page.
 */
function drawApparition(presence) {
  const { sx, sy } = apparitionCell(haunt.index);
  const srcSlice = APPARITION_CELL_H / HAUNT_SLICES;
  const dstSlice = haunt.h / HAUNT_SLICES;

  /* The warp travels: the phase advances with the clock, so the deformation
     runs down the figure rather than sitting still in it. */
  const phase = haunt.phase + hauntClock * 1.1;

  /* It flattens as it presses. Something pushed hard against glass has less
     slack in it than something still coming through the fog, and dropping the
     amplitude at the peak is what sells the contact. */
  const amount = haunt.w * HAUNT_WARP_FRAC * (1.15 - presence * 0.55);

  atmosCtx.save();
  atmosCtx.globalAlpha = presence;
  if (haunt.flip) {
    atmosCtx.translate(haunt.x + haunt.w, 0);
    atmosCtx.scale(-1, 1);
  } else {
    atmosCtx.translate(haunt.x, 0);
  }

  for (let i = 0; i < HAUNT_SLICES; i += 1) {
    const dx = hauntWarpAt(i / HAUNT_SLICES, phase, amount);

    /* The +1 on the heights overlaps each strip into the next. Without it,
       rounding leaves hairline gaps and the figure comes out looking like a
       venetian blind. */
    atmosCtx.drawImage(
      apparitionSheet,
      sx, sy + i * srcSlice, APPARITION_CELL_W, srcSlice + 1,
      dx, haunt.y + i * dstSlice, haunt.w, dstSlice + 1
    );
  }

  atmosCtx.restore();
}

/** Draw the handprint. Flat, unwarped, slightly off-square. */
function drawHandprint(presence) {
  const { sx, sy } = apparitionCell(hauntPrint.index);

  atmosCtx.save();
  atmosCtx.globalAlpha = presence;
  atmosCtx.translate(hauntPrint.x + hauntPrint.w / 2, hauntPrint.y + hauntPrint.h / 2);
  atmosCtx.rotate(hauntPrint.tilt);
  if (hauntPrint.flip) atmosCtx.scale(-1, 1);
  atmosCtx.drawImage(
    apparitionSheet,
    sx, sy, APPARITION_CELL_W, APPARITION_CELL_H,
    -hauntPrint.w / 2, -hauntPrint.h / 2, hauntPrint.w, hauntPrint.h
  );
  atmosCtx.restore();
}

/** Draw one frame of the haunt. */
function drawHaunt(dt) {
  hauntClock += dt;
  moveFog(dt);

  atmosCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  drawFog(false);

  /* Nothing figurative until the atlas has actually arrived. The fog on its
     own is a complete background, so a slow connection sees a quiet room
     rather than a broken one. */
  if (apparitionReady) {
    if (!haunt && hauntClock >= hauntNextAt) spawnApparition();

    if (haunt) {
      const p = (hauntClock - haunt.born) / HAUNT_LIFE;
      if (p >= 1) {
        haunt = null;
        hauntNextAt = hauntClock + (HAUNT_GAP_MIN + Math.random() * HAUNT_GAP_VAR) * gapScale();
      } else {
        drawApparition(hauntPresence(p));
      }
    }

    /* The print layer, on its own clock, deliberately unrelated to the above. */
    if (!hauntPrint && hauntClock >= hauntPrintNextAt) spawnHandprint();

    if (hauntPrint) {
      const p = (hauntClock - hauntPrint.born) / HAUNT_PRINT_LIFE;
      if (p >= 1) {
        hauntPrint = null;
        hauntPrintNextAt = hauntClock
          + (HAUNT_PRINT_GAP_MIN + Math.random() * HAUNT_PRINT_GAP_VAR) * gapScale();
      } else {
        drawHandprint(printPresence(p));
      }
    }
  }

  drawFog(true);
}

/* ============================================================
   THE LOOP
   ============================================================ */

/**
 * One frame, at ATMOS_FPS rather than at the display's rate.
 *
 * requestAnimationFrame still drives this — it is the only clock that knows
 * when the browser is actually about to paint — but most of those callbacks
 * return immediately without drawing anything.
 */
function atmosLoop(now) {
  atmosFrame = requestAnimationFrame(atmosLoop);

  const elapsed = now - atmosLastPaint;
  if (elapsed < 1000 / ATMOS_FPS) return;

  /* Clamp the delta. Coming back to a tab that has been hidden, or a machine
     that has been asleep, otherwise hands the fog a delta of several minutes
     and teleports every bank off the screen at once. */
  const dt = Math.min(elapsed / 1000, 0.1);
  atmosLastPaint = now;

  if (atmosTheme === 'light') drawHaunt(dt);
  else drawRain();
}

/**
 * Stop drawing while the tab is in the background.
 *
 * requestAnimationFrame already throttles heavily when a tab is hidden, but
 * cancelling outright means a backgrounded tab does no work at all. This is
 * the one animation in the app that runs continuously, so it is the one worth
 * being careful about.
 */
function handleAtmosVisibility() {
  if (document.hidden) {
    cancelAnimationFrame(atmosFrame);
    atmosFrame = null;
  } else if (atmosFrame === null) {
    atmosLastPaint = 0;
    atmosFrame = requestAnimationFrame(atmosLoop);
  }
}

function setUpAtmosphere() {
  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Falling text across the whole screen, and figures moving behind the
     interface, are both exactly the kind of continuous motion this setting
     exists to switch off. The page keeps its CSS haze and vignette, so
     neither theme is left looking unfinished. */
  if (prefersReducedMotion) return false;

  atmosCanvas = document.createElement('canvas');
  atmosCanvas.className = 'rain';
  atmosCanvas.setAttribute('aria-hidden', 'true');

  atmosCtx = atmosCanvas.getContext('2d');

  /* No 2-D backend available: this is decoration, so leave quietly rather
     than throw and take the page's other scripts down. */
  if (!atmosCtx) return false;

  document.body.appendChild(atmosCanvas);

  readAtmosColors();
  sizeAtmosphere();
  syncAtmosphere();

  window.addEventListener('resize', sizeAtmosphere);
  document.addEventListener('visibilitychange', handleAtmosVisibility);
  atmosFrame = requestAnimationFrame(atmosLoop);

  return true;
}

/* Same contract as every other page script: stay out of the way entirely if
   the auth guard is already sending this visitor somewhere else. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', setUpAtmosphere);
}
