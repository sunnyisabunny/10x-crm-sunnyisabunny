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

  atmosCanvas.style.opacity = String(atmosTheme === 'light' ? HAUNT_OPACITY : RAIN_OPACITY);

  if (atmosTheme === 'light') resetHaunt();
  else resetRain();
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

   Three layers, painted back to front on every frame:

     far fog        slow banks, established first so there is depth
     the apparition rises out of the far fog, presses, recedes
     near fog       painted OVER it, so it never fully resolves

   That sandwich is the whole illusion. A silhouette drawn on top of fog is a
   sticker; a silhouette drawn INSIDE fog is something in the room.
   ============================================================ */

/* How faint the whole layer is. Lower than the rain's, because this sits
   under body text on a pale background where there is far less contrast to
   spare, and because a thing you can only half-see is worse than a thing you
   can see. */
const HAUNT_OPACITY = 0.5;

/* Fog banks. Five is enough to never look like a repeating pattern and few
   enough that the per-frame gradient work stays trivial. */
const FOG_COUNT = 5;

/* Seconds an apparition takes from first appearing to gone. */
const HAUNT_LIFE = 11;

/* Seconds of empty fog between apparitions, minimum and extra-random.
   Deliberately long. Dread is a function of waiting: something that appears
   every four seconds is a screensaver, not a haunting. */
const HAUNT_GAP_MIN = 14;
const HAUNT_GAP_VAR = 22;

/* How far, in path units, a slice can be pushed sideways. Rendered and looked
   at across a range before this was chosen: below about 3 the figure stays a
   clean symmetrical mask and reads as a logo, and above about 9 the fingers
   of a hand merge into one another. */
const HAUNT_WARP = 6.5;

/* How many horizontal slices a figure is cut into. The stepping between
   slices is not a defect to be smoothed away — it is the same analog-tearing
   vocabulary as the scanlines, and it is what stops the warp reading as a
   soft liquid wobble. */
const HAUNT_SLICES = 26;

/*
  THE APPARITIONS.

  SVG path data, exactly as authored, handed to Path2D — which accepts the
  `d` attribute of an SVG <path> directly. So this is real vector art with no
  image request, no binary asset in the repo, and nothing to fall out of sync
  with a source file that no longer exists.

  Filled with the even-odd rule, which is what lets the eye and mouth
  subpaths cut holes out of the head. It is also why every hand is drawn as
  ONE continuous outline including its thumb: a separate thumb subpath would
  overlap the palm and, under even-odd, punch a hole through it instead of
  joining on.

  `box` is the authored bounding box, and the only thing that maps these
  coordinates onto the screen.
*/
const HAUNT_FIGURES = [
  /* Screaming. Head elongated downwards, mouth pulled into a long vertical
     oval — the single most legible horror silhouette there is. */
  {
    box: [100, 124],
    d: 'M50 6 C31 6 19 22 18 42 C17 58 21 72 27 86 C32 98 41 118 50 118'
     + ' C59 118 68 98 73 86 C79 72 83 58 82 42 C81 22 69 6 50 6 Z'
     + ' M27 41 C33 32 46 34 50 45 C45 53 30 52 27 41 Z'
     + ' M51 45 C55 34 68 32 73 41 C69 52 55 53 51 45 Z'
     + ' M42 66 C46 61 54 61 58 66 C61 76 60 95 50 102 C40 95 39 76 42 66 Z',
  },
  /* Smeared sideways, as though the head were dragged during a long
     exposure. Features slide right and down out of alignment. */
  {
    box: [100, 112],
    d: 'M44 8 C25 11 15 27 17 47 C19 64 27 79 39 93 C47 102 58 107 66 102'
     + ' C77 96 81 83 79 67 C77 47 70 27 61 15 C57 9 50 7 44 8 Z'
     + ' M28 47 C35 42 47 44 51 49 C45 53 32 53 28 47 Z'
     + ' M56 54 C62 50 70 52 73 57 C68 60 60 59 56 54 Z'
     + ' M37 73 C46 68 59 71 63 78 C57 86 44 84 37 73 Z',
  },
  /* Head tilted back, jaw hanging open. Reads as something looking upward
     rather than at you, which is worse. */
  {
    box: [100, 120],
    d: 'M48 14 C30 14 19 28 20 46 C21 60 27 70 35 78 C41 84 45 92 47 102'
     + ' C49 112 58 114 64 108 C72 100 80 88 84 73 C88 57 85 34 75 23'
     + ' C68 15 58 14 48 14 Z'
     + ' M30 40 C37 32 51 35 55 44 C49 51 34 50 30 40 Z'
     + ' M55 62 C65 56 77 62 79 74 C77 88 64 96 54 91 C47 83 47 69 55 62 Z',
  },
  /* Half-formed. Only one eye resolves; the other side never arrives. The
     most useful of the four, because it is the one that looks like the fog
     failed to finish rendering something. */
  {
    box: [100, 118],
    d: 'M52 4 C34 6 24 22 24 44 C24 62 30 80 40 96 C46 106 54 114 62 112'
     + ' C70 110 74 98 74 84 C74 60 70 30 64 16 C61 8 57 3 52 4 Z'
     + ' M36 46 C42 40 52 42 55 49 C50 54 39 53 36 46 Z'
     + ' M40 76 C48 72 60 74 64 80 C58 85 46 83 40 76 Z',
  },
  /* A splayed palm with the thumb out.

     Proportions matter more than detail at this size. The palm is nearly
     square and tapers to a narrow wrist; the middle finger is clearly the
     longest and the little finger clearly the shortest. Get that ordering
     wrong and the shape stops reading as a hand however good the curves are,
     which is exactly what the first attempt got wrong — it came out a
     cartoon mitten. */
  {
    box: [100, 144],
    d: 'M38 142 L34 128 C28 122 25 118 25 112'
     + ' C18 114 10 112 5 106 C2 102 4 96 9 95 C15 94 22 96 26 92'
     + ' C25 82 25 74 26 64'
     + ' L27 30 C27 22 32 19 37 20 C41 21 43 26 43 33 L43 60'
     + ' L45 15 C45 8 50 5 55 6 C59 7 60 12 60 19 L58 58'
     + ' L64 21 C65 14 70 11 74 13 C78 15 78 21 77 27 L72 61'
     + ' L79 42 C81 36 86 34 89 37 C92 40 91 45 89 50 L80 68'
     + ' C82 82 82 98 80 110 C78 124 70 134 60 140 L58 142 Z',
  },
  /* Fingers curled and trailing, as if the hand were sliding down the glass
     rather than pushing against it. */
  {
    box: [100, 146],
    d: 'M40 144 L35 130 C29 124 26 119 26 113'
     + ' C19 118 10 117 5 111 C2 106 5 100 10 100 C16 100 22 102 27 98'
     + ' C26 88 26 78 28 68'
     + ' L18 38 C15 31 19 25 25 26 C30 27 33 33 34 40 L42 62'
     + ' L31 22 C29 14 34 9 39 10 C44 11 46 17 47 24 L52 58'
     + ' L58 20 C59 13 65 10 69 13 C73 16 73 22 71 29 L66 60'
     + ' L80 46 C84 41 90 42 90 48 C90 54 85 58 80 61 L74 70'
     + ' C79 84 79 100 77 112 C75 126 68 136 60 142 L58 144 Z',
  },
  /* Pressed completely flat, fingers together. The palm becomes a broad
     paddle and the fingers survive only as three narrow slits, which is
     genuinely what a hand looks like pushed hard against frosted glass — the
     contact area whitens out and the separations are all that is left. The
     least figurative of the seven, and the most unsettling precisely because
     it takes a moment to resolve. */
  {
    box: [104, 128],
    d: 'M50 124 C34 123 24 112 23 97 C22 78 25 55 29 37'
     + ' C31 25 39 18 49 18 C61 18 71 23 77 33'
     + ' C85 47 89 71 87 91 C85 110 70 124 50 124 Z'
     + ' M39 26 C41 23 44 24 44 27 C45 40 45 54 44 64 C42 67 39 66 38 62'
     + ' C37 50 37 36 39 26 Z'
     + ' M54 23 C56 20 59 21 59 25 C60 39 59 55 58 65 C56 68 53 67 53 63'
     + ' C52 49 52 34 54 23 Z'
     + ' M69 32 C71 29 74 31 74 34 C74 46 72 59 70 67 C68 69 65 68 65 64'
     + ' C66 51 67 42 69 32 Z',
  },
];

let fogBanks = [];
let haunt = null;          // the apparition currently on screen, or null
let hauntNextAt = 0;       // seconds on the atmosphere clock until the next one
let hauntClock = 0;        // seconds since the haunt started running

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
  hauntClock = 0;
  hauntNextAt = 3;   // a short first wait, so the theme does not look inert
}

/**
 * Choose the next apparition and where it stands.
 *
 * Figures are placed towards the edges of the screen on purpose. The middle of
 * the viewport is where the interface is, and something looming directly
 * behind a client's name is not atmospheric, it is a legibility bug.
 */
function spawnApparition() {
  /* Not while a modal is open. A modal exists because the user is being asked
     to read or decide something, and the whole app is dimmed behind it. This
     is checked here, once, rather than in the draw loop — a DOM query per
     frame is exactly the kind of thing this file was just cleaned of. */
  if (document.querySelector('.overlay:not([hidden])')) {
    hauntNextAt = hauntClock + 4;
    return;
  }

  const figure = HAUNT_FIGURES[Math.floor(Math.random() * HAUNT_FIGURES.length)];
  const height = window.innerHeight * (0.42 + Math.random() * 0.3);
  const scale = height / figure.box[1];
  const edge = Math.random() < 0.5 ? 0 : 1;

  haunt = {
    path: new Path2D(figure.d),
    box: figure.box,
    scale,
    /* Out towards one side, with enough variation that it is never the same
       two positions over and over. */
    x: edge
      ? window.innerWidth * (0.66 + Math.random() * 0.22)
      : window.innerWidth * (0.06 + Math.random() * 0.18),
    y: window.innerHeight * (0.12 + Math.random() * 0.3),
    /* Half of them come through facing the other way. */
    flip: Math.random() < 0.5,
    phase: Math.random() * Math.PI * 2,
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
  if (p < 0.30) return (p / 0.30) * 0.55;                     // rising
  if (p < 0.55) return 0.55;                                  // holding
  if (p < 0.70) return 0.55 + ((p - 0.55) / 0.15) * 0.45;     // pressing
  return Math.max(0, 1 - (p - 0.70) / 0.30);                  // withdrawing
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
 * WHY IT IS PRE-RENDERED
 * The obvious way to do this is to clip to each slice and fill the path again
 * inside it — twenty-six full path fills per frame. Instead the figure is
 * filled ONCE into an offscreen canvas when it spawns, and each frame simply
 * blits twenty-six strips of that image at different horizontal offsets.
 * A strip copy is enormously cheaper than a path fill, and the result is
 * pixel-identical.
 */
function drawApparition(presence) {
  const sheet = haunt.sheet;
  const sliceH = sheet.height / HAUNT_SLICES;

  /* The warp travels: the phase advances with the clock, so the deformation
     runs down the figure rather than sitting still in it. */
  const phase = haunt.phase + hauntClock * 1.1;

  /* It flattens as it presses. A hand pushed hard against glass has less
     slack in it than one still coming through the fog, and dropping the
     amplitude at the peak is what sells the contact. */
  const amount = HAUNT_WARP * haunt.scale * (1.15 - presence * 0.55);

  atmosCtx.save();
  atmosCtx.globalAlpha = presence;
  atmosCtx.translate(haunt.x, haunt.y);
  if (haunt.flip) atmosCtx.scale(-1, 1);

  for (let i = 0; i < HAUNT_SLICES; i += 1) {
    const sy = i * sliceH;
    const dx = hauntWarpAt(i / HAUNT_SLICES, phase, amount);

    /* The +1 on the height overlaps each strip into the next by a pixel.
       Without it, rounding leaves hairline gaps between the slices and the
       figure comes out looking like a venetian blind. */
    atmosCtx.drawImage(
      sheet,
      0, sy, sheet.width, sliceH + 1,
      dx, sy, sheet.width, sliceH + 1
    );
  }

  atmosCtx.restore();
}

/**
 * Render one figure into an offscreen canvas, once.
 *
 * Two passes. The silhouette itself in --apparition, and then — only when it
 * presses — a slightly smaller, paler copy on top. That second pass is the
 * whitening you get where skin actually touches frosted glass, and it is the
 * detail that makes the press read as contact rather than as the figure
 * simply getting darker.
 */
function renderApparitionSheet(presence) {
  const [bw, bh] = haunt.box;
  const w = Math.ceil(bw * haunt.scale);
  const h = Math.ceil(bh * haunt.scale);

  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h;

  const ctx = sheet.getContext('2d');
  if (!ctx) return null;

  ctx.scale(haunt.scale, haunt.scale);
  ctx.fillStyle = atmosColors.apparition;
  ctx.fill(haunt.path, 'evenodd');

  if (presence > 0.75) {
    ctx.globalAlpha = (presence - 0.75) * 2.2;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.translate(bw / 2, bh / 2);
    ctx.scale(0.9, 0.9);
    ctx.translate(-bw / 2, -bh / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill(haunt.path, 'evenodd');
  }

  return sheet;
}

/** Draw one frame of the haunt. */
function drawHaunt(dt) {
  hauntClock += dt;
  moveFog(dt);

  atmosCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  drawFog(false);

  if (!haunt && hauntClock >= hauntNextAt) spawnApparition();

  if (haunt) {
    const p = (hauntClock - haunt.born) / HAUNT_LIFE;

    if (p >= 1) {
      haunt = null;
      hauntNextAt = hauntClock + HAUNT_GAP_MIN + Math.random() * HAUNT_GAP_VAR;
    } else {
      const presence = hauntPresence(p);

      /* Rebuilding the sheet allocates a canvas and fills the path again, so
         it is done as rarely as the picture allows: once when the figure
         arrives, and then only while the contact highlight is actually
         changing — and even then only when it has changed by enough to see.
         Quantising to twentieths turns roughly fifty rebuilds per apparition
         into about five, with no visible difference. */
      const step = Math.round(presence * 20);
      if (!haunt.sheet || (presence > 0.75 && step !== haunt.sheetStep)) {
        haunt.sheet = renderApparitionSheet(presence) || haunt.sheet;
        haunt.sheetStep = step;
      }
      if (haunt.sheet) drawApparition(presence);
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
