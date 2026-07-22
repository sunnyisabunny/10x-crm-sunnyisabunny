/**
 * assistant.js — RONIN, the pixel samurai who actually does a job.
 *
 * ============================================================================
 * WHAT HE IS FOR
 * ============================================================================
 * He started as decoration: a sprite in the corner who said a random line when
 * clicked. Decoration is fine, but this app already knows things the user does
 * not — which deals have gone quiet, which are stuck, whether the revenue is
 * dangerously concentrated — and that knowledge was locked on the analytics
 * page, where you only see it if you go looking.
 *
 * So RONIN carries it to you instead. He does three jobs:
 *
 *   1. THE BADGE. A live count of things that need attention, visible on every
 *      page without opening anything.
 *   2. THE COACH. Click him and he names the single most urgent problem, with
 *      a button that takes you straight to the client involved.
 *   3. THE TOUR. On a brand new account he offers a short walkthrough of the
 *      interface, one step per page.
 *
 * He gets the facts from buildFindings() in data.js — the same function the
 * analytics board renders. That is the point: he cannot tell you something the
 * page would disagree with, because there is only one copy of the rules.
 *
 * ============================================================================
 * HOW THE ANIMATION WORKS
 * ============================================================================
 * The art is one PNG holding every frame of every animation. Drawing a frame
 * means copying a rectangle out of that image onto a canvas, which is exactly
 * what the nine-argument form of drawImage does:
 *
 *     drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)
 *                      \__ source __/  \_ destination _/
 *
 *     source      = which rectangle to cut out of the sheet
 *     destination = where on the canvas to paste it, and how big
 *
 * One image request covers all forty-one frames, and switching animation means
 * changing which row of the sheet the loop reads from.
 *
 * The sheet is a UNIFORM GRID: one row per animation, every cell the same
 * size. That is not how it arrived — it was repacked into this shape, on
 * purpose, because a uniform grid turns "find frame 3 of the walk" into two
 * multiplications instead of a lookup table of forty-one hand-measured
 * rectangles that nobody could check by eye.
 *
 * Loaded after ui.js and data.js, whose showToast and buildFindings he uses.
 */

/* ==================================================================
   1. THE SPRITE SHEET
   ================================================================== */

const RONIN_SHEET_SRC = 'assets/ronin.png';

/* One cell of the grid, in sheet pixels. Every frame is cut at this size. */
const RONIN_FRAME_W = 158;
const RONIN_FRAME_H = 120;

/*
  Which row of the sheet each animation lives on, and how many frames it has.

  `loop: false` means play once and fall back to idle — right for a sword
  swing, wrong for a walk cycle. A swing that repeats forever is a windmill.
*/
const RONIN_ANIMATIONS = {
  idle:   { row: 0, frames: 4, ms: 420, loop: true },
  jump:   { row: 1, frames: 2, ms: 220, loop: false },
  attack: { row: 2, frames: 4, ms: 90,  loop: false },
  walk:   { row: 3, frames: 6, ms: 120, loop: true },
  defend: { row: 4, frames: 4, ms: 140, loop: false },
  run:    { row: 5, frames: 6, ms: 80,  loop: true },
  ready:  { row: 6, frames: 2, ms: 500, loop: true },
  slash:  { row: 7, frames: 4, ms: 100, loop: false },
  death:  { row: 8, frames: 4, ms: 260, loop: false },
  dodge:  { row: 9, frames: 5, ms: 110, loop: false },
};

/* How big he is drawn on screen. The sheet cell is 158x120; drawing him
   smaller than that keeps the pixels crisp, because shrinking pixel art is
   far kinder to it than blowing it up. */
const RONIN_DRAW_W = 104;
const RONIN_DRAW_H = 79;

/* ==================================================================
   2. TIMING
   ================================================================== */

const RONIN_ENTRANCE_PX = 140;    // how far off-screen he starts
const RONIN_ENTRANCE_MS = 1200;   // how long he takes to walk in
const RONIN_TYPE_MS = 18;         // per character, when he speaks
const RONIN_REACTION_MS = 4200;   // how long a reaction bubble stays up

/* How long after page load before he offers the tour. Long enough that the
   page has settled and the user has looked at it. */
const RONIN_TOUR_DELAY_MS = 1600;

/* ==================================================================
   3. WHAT HE SAYS
   ================================================================== */

/*
  The tour: one step per page, in the order someone would naturally visit them.

  `page` is which page the step is about. `go` is where the Next button sends
  you, so the tour walks the user through the actual app rather than describing
  it from one screen.
*/
const RONIN_TOUR = [
  {
    page: 'dashboard',
    title: 'This is your dashboard',
    body: 'Four numbers that answer "how are we doing". Won revenue counts '
        + 'closed deals only, so it is money in rather than money hoped for.',
    go: 'clients.html',
    goLabel: 'Show me the clients',
  },
  {
    page: 'clients',
    title: 'Your client database',
    body: 'Search, filter and sort all stack — use all three at once. Click a '
        + 'card to open its history and write a note. Press / to jump to '
        + 'search, or ? for every shortcut.',
    go: 'analytics.html',
    goLabel: 'What is Analytics for?',
  },
  {
    page: 'analytics',
    title: 'This board finds problems',
    body: 'The dashboard tells you what is. This tells you what is wrong: '
        + 'deals gone quiet, deals stuck, revenue leaning on one account. It '
        + 'names the clients so you can act on it.',
    go: 'profile.html',
    goLabel: 'Last stop',
  },
  {
    page: 'profile',
    title: 'And this is you',
    body: 'Change your name and the dashboard greeting follows. Reset wipes '
        + 'the client list but never your account. That is the tour — I will '
        + 'be in the corner if you need the state of the book.',
    go: null,
    goLabel: null,
  },
];

/* Short things he says when the app announces something, rather than when he
   is asked. Keyed by the toast type ui.js reports. */
const RONIN_REACTIONS = {
  success: ['Clean cut.', 'Done.', 'Filed.', 'Another one handled.'],
  error: ['That did not land.', 'Something is wrong.', 'Try that again.'],
  info: ['Noted.', 'Understood.'],
};

/* ==================================================================
   4. STATE
   ================================================================== */

let roninSheet = null;         // the loaded Image
let roninCanvas = null;
let roninCtx = null;
let roninRoot = null;          // the whole fixed-position widget
let roninPanel = null;         // the speech panel, hidden when collapsed
let roninBadge = null;

let roninAnimation = 'idle';
let roninFrameIndex = 0;
let roninFrameTimer = null;

let roninTypeTimer = null;
let roninHideTimer = null;

let roninOpen = false;         // is the panel showing?
let roninAdvice = [];          // the queue of things worth saying
let roninAdviceIndex = 0;
let roninTourStep = null;      // the tour step for this page, or null

/* ==================================================================
   5. DRAWING
   ================================================================== */

/**
 * Paint the current frame.
 *
 * clearRect first, because a canvas draws ON TOP of whatever is already there
 * rather than replacing it. Without clearing, every frame would smear over the
 * last and he would turn into a blur of overlapping poses.
 *
 * The source rectangle is pure arithmetic thanks to the uniform grid:
 * column times cell width, row times cell height.
 */
function drawRonin() {
  if (!roninCtx || !roninSheet) return;

  const animation = RONIN_ANIMATIONS[roninAnimation];
  const column = roninFrameIndex % animation.frames;

  roninCtx.clearRect(0, 0, roninCanvas.width, roninCanvas.height);

  roninCtx.drawImage(
    roninSheet,
    column * RONIN_FRAME_W, animation.row * RONIN_FRAME_H,   // where in the sheet
    RONIN_FRAME_W, RONIN_FRAME_H,                            // how much of it
    0, 0, RONIN_DRAW_W, RONIN_DRAW_H                         // where on the canvas
  );
}

/**
 * Switch animation.
 *
 * The previous frame timer is always cleared first. Without that, two
 * animations started in quick succession would leave two intervals advancing
 * the same counter, and he would flicker between two sequences at once. This
 * is the same class of bug that made the analytics boot log print twice.
 */
function playRonin(name) {
  clearInterval(roninFrameTimer);

  const animation = RONIN_ANIMATIONS[name] || RONIN_ANIMATIONS.idle;
  roninAnimation = RONIN_ANIMATIONS[name] ? name : 'idle';
  roninFrameIndex = 0;
  drawRonin();

  if (animation.frames <= 1) return;   // a single-frame pose needs no timer

  roninFrameTimer = setInterval(() => {
    roninFrameIndex += 1;

    if (!animation.loop && roninFrameIndex >= animation.frames) {
      clearInterval(roninFrameTimer);
      /* Back to whatever his resting state is: guarding while the panel is
         open, simply standing otherwise. */
      playRonin(roninOpen ? 'ready' : 'idle');
      return;
    }

    drawRonin();
  }, animation.ms);
}

/**
 * Walk in from off to the left, then settle.
 *
 * Two things have to happen together or it does not read as walking: the walk
 * cycle animates his legs, and a CSS transition slides the whole element
 * across the screen. Feet moving on the spot, or a figure gliding sideways in
 * a fixed pose, are each obviously wrong.
 */
function roninEntrance() {
  playRonin('walk');

  roninRoot.style.transform = `translateX(${-RONIN_ENTRANCE_PX}px)`;
  roninRoot.style.opacity = '0';

  /* Next frame, so the browser registers the starting position before the
     transition begins. Setting both values in the same frame would jump
     straight to the end with no animation at all. */
  requestAnimationFrame(() => {
    roninRoot.style.transition =
      `transform ${RONIN_ENTRANCE_MS}ms linear, opacity 500ms ease-out`;
    roninRoot.style.transform = 'translateX(0)';
    roninRoot.style.opacity = '1';
  });

  setTimeout(() => playRonin('idle'), RONIN_ENTRANCE_MS);
}

/* ==================================================================
   6. THE ADVICE — what makes him an assistant rather than a mascot
   ================================================================== */

/**
 * Turn the state of the client list into a queue of things worth saying.
 *
 * Every entry has the same shape so the panel can render any of them without
 * knowing which kind it is:
 *
 *   level  FAIL | WARN | INFO | OK   — drives the colour and his pose
 *   title  the headline, one line
 *   body   the detail, naming actual clients
 *   go     a URL to act on it, or null
 *
 * The findings come from data.js, unchanged and in the same order the
 * analytics board shows them, so he is quoting the report rather than forming
 * a second opinion.
 */
function buildAdvice(clients) {
  if (clients.length === 0) {
    return [{
      level: 'INFO',
      title: 'No clients yet',
      body: 'Nothing to report until there is a book to report on. Add your '
          + 'first client and I will start watching it.',
      go: 'clients.html',
      goLabel: 'Add a client',
    }];
  }

  const metrics = computeMetrics(clients);
  const findings = buildFindings(clients, metrics);

  /* The card about the page you are actually on comes first, then the
     problems. See pageCard() for why he says something different per page. */
  const advice = [pageCard(clients, metrics)];

  return advice.concat(adviceFromFindings(findings, metrics));
}

/**
 * One card about the page the user is currently looking at.
 *
 * WHY THIS EXISTS. Everything else he says is a diagnosis of the whole client
 * list, which is the same on every page by definition — so he was giving an
 * identical answer on the dashboard, the clients page, the analytics board and
 * the profile. Correct, and useless: an assistant that ignores where you are
 * standing is a noticeboard.
 *
 * So each page gets one line about itself first, drawn from the same metrics.
 * `currentPage` comes from the data-page attribute on <html>, set in the HTML
 * and read by app.js.
 */
function pageCard(clients, metrics) {
  const openCount = metrics.open.length;

  if (currentPage === 'clients') {
    return {
      level: 'INFO',
      title: `${clients.length} clients, ${openCount} still open`,
      body: `${formatMoney(metrics.openValue)} is sitting in open deals on this `
          + `page. Filter, search and sort stack — use all three at once. Press `
          + `/ to search, ? for every shortcut.`,
      go: 'analytics.html',
      goLabel: 'What needs attention?',
    };
  }

  if (currentPage === 'analytics') {
    return {
      level: 'INFO',
      title: metrics.rateIsMeaningful
        ? `You close ${Math.round(metrics.winRate * 100)}% of what you finish`
        : 'Not enough closed deals to judge a win rate yet',
      body: `Average deal takes ${metrics.cycleDays} days. `
          + `${formatMoney(metrics.openValue)} is open, which at your rate is `
          + `worth about ${formatMoney(metrics.forecast)}. Export writes all of `
          + `this to a file — your password never goes in it.`,
      go: null,
      goLabel: null,
    };
  }

  if (currentPage === 'profile') {
    return {
      level: 'INFO',
      title: 'This is your account, not your data',
      body: `Reset wipes all ${clients.length} clients and reloads the original `
          + `records. Your login survives it. A new password needs the old one `
          + `first, and a photo is shrunk to 128 pixels before it is saved.`,
      go: 'analytics.html',
      goLabel: 'Back up first',
    };
  }

  /* The dashboard, and anything unexpected. */
  return {
    level: 'INFO',
    title: `${formatMoney(metrics.wonValue)} won, ${formatMoney(metrics.openValue)} still open`,
    body: metrics.thisMonth >= metrics.lastMonth
      ? `${formatMoney(metrics.thisMonth)} closed this month against `
        + `${formatMoney(metrics.lastMonth)} last. Moving the right way.`
      : `${formatMoney(metrics.thisMonth)} closed this month against `
        + `${formatMoney(metrics.lastMonth)} last. Behind where you were.`,
    go: 'analytics.html',
    goLabel: 'See the full board',
  };
}

/**
 * The problems, worst first, each naming the client it is about.
 *
 * `metrics` is passed in rather than recomputed. It has to be: this used to be
 * part of buildAdvice() where metrics was a local variable, and pulling it out
 * into its own function left the reference below pointing at nothing. In a
 * project of classic scripts sharing one global scope that is exactly the kind
 * of mistake that survives a read-through, because the name looks like it
 * might be global.
 */
function adviceFromFindings(findings, metrics) {
  const advice = findings
    /* OK findings are worth showing on the analytics board, where the point is
       a complete report. Here they would bury the one thing that matters. */
    .filter((finding) => finding.level !== 'OK')
    .map((finding) => {
      /* Name the worst client, and make the button go to them. A finding that
         says "6 deals have gone quiet" is a statistic; one that says "worst is
         Emily Johnson, 23 days" is something you can do next. */
      const worst = finding.rows[0];

      return {
        level: finding.level,
        title: finding.title,
        body: worst
          ? `Worst: ${worst.name} — ${worst.meta}, ${formatMoney(worst.value)} on the table.`
          : (finding.hint || ''),
        /* A client id in the URL, which clients.js opens on arrival. */
        go: worst ? `clients.html?client=${encodeURIComponent(worst.id)}` : 'analytics.html',
        goLabel: worst ? `Open ${worst.name}` : 'Show me the board',
      };
    });

  if (advice.length === 0) {
    advice.push({
      level: 'OK',
      title: 'Nothing needs you right now',
      body: `Every open deal has been touched recently, nothing is running `
          + `long, and revenue is spread about. ${formatMoney(metrics.forecast)} `
          + `is the realistic value of what is still open.`,
      go: 'analytics.html',
      goLabel: 'See the full board',
    });
  }

  return advice;
}

/** How many findings are actually problems. This is the badge number. */
function countProblems(advice) {
  return advice.filter((item) => item.level === 'FAIL' || item.level === 'WARN').length;
}

/**
 * The pose that matches a severity.
 *
 * Giving each level its own animation means the character is carrying
 * information rather than just moving: a guard stance reads as "brace", a
 * collapse reads as "this is bad", a jump reads as "all clear".
 */
function poseFor(level) {
  if (level === 'FAIL') return 'death';
  if (level === 'WARN') return 'defend';
  if (level === 'OK') return 'jump';
  return 'ready';
}

/* ==================================================================
   7. SPEAKING
   ================================================================== */

/**
 * Type text into an element one character at a time.
 *
 * Any line still being typed is cancelled first, so clicking twice quickly
 * cannot leave two intervals writing into the same element — they would
 * interleave and produce nonsense.
 *
 * textContent rather than innerHTML, for the same reason as everywhere else in
 * this app: client names appear in these lines, and a name is user input.
 */
function typeInto(element, text, done) {
  clearInterval(roninTypeTimer);
  element.textContent = '';

  let index = 0;
  roninTypeTimer = setInterval(() => {
    index += 1;
    element.textContent = text.slice(0, index);

    if (index >= text.length) {
      clearInterval(roninTypeTimer);
      if (done) done();
    }
  }, RONIN_TYPE_MS);
}

/* ==================================================================
   8. THE PANEL
   ================================================================== */

/** Show one advice card, or one tour step. */
function renderCard(card) {
  const title = roninPanel.querySelector('.ronin__title');
  const body = roninPanel.querySelector('.ronin__body');
  const go = roninPanel.querySelector('.ronin__go');
  const next = roninPanel.querySelector('.ronin__next');

  roninPanel.dataset.level = card.level || 'INFO';
  title.textContent = card.title;

  typeInto(body, card.body);

  if (card.go) {
    go.hidden = false;
    go.textContent = card.goLabel || 'Take me there';
    go.dataset.href = card.go;
  } else {
    go.hidden = true;
  }

  /* Only offer "next" when there is genuinely another card behind this one. */
  next.hidden = roninAdvice.length <= 1 || roninTourStep !== null;

  playRonin(poseFor(card.level));
}

function openRonin() {
  roninOpen = true;
  roninRoot.dataset.open = 'true';
  roninPanel.hidden = false;

  if (roninTourStep) {
    renderCard({ ...roninTourStep, level: 'INFO', go: roninTourStep.go, goLabel: roninTourStep.goLabel });
    return;
  }

  /*
    Always rebuild, never reuse.

    This used to only rebuild when the queue happened to be empty, which meant
    whatever he worked out at page load was what he said for the rest of the
    visit. That is wrong in a very ordinary situation: on a first visit the
    client list is still being fetched from the API when he wakes up, so he
    would decide "no clients yet", the thirty would arrive a moment later, and
    he would go on insisting the CRM was empty until the page was reloaded.

    Rebuilding costs a pass over a few dozen clients and happens only when
    someone clicks him, so there is no reason to cache it at all.
  */
  roninAdvice = buildAdvice(roninClients());
  roninAdviceIndex = 0;
  renderCard(roninAdvice[0]);
}

function closeRonin() {
  roninOpen = false;
  roninRoot.dataset.open = 'false';
  roninPanel.hidden = true;
  clearInterval(roninTypeTimer);
  playRonin('idle');
}

function toggleRonin() {
  if (roninOpen) closeRonin();
  else openRonin();
}

/** Move to the next piece of advice, wrapping round. */
function nextAdvice() {
  roninAdviceIndex = (roninAdviceIndex + 1) % roninAdvice.length;
  renderCard(roninAdvice[roninAdviceIndex]);
}

/* ==================================================================
   9. REACTING TO THE APP
   ================================================================== */

/**
 * React when the app announces something.
 *
 * ui.js dispatches a `crm:toast` event every time it shows a notification, and
 * RONIN listens for it. Going through an event rather than calling him
 * directly keeps the two apart: clients.js and profile.js know nothing about
 * him, he knows nothing about them, and deleting this whole file would leave
 * the rest of the app working exactly as before. That is what a custom event
 * is for — announcing something without needing to know who is listening.
 */
function handleRoninEvent(event) {
  const type = event.detail?.type || 'info';

  /* Data changed, so anything he was about to say may now be out of date. */
  roninAdvice = [];
  roninAdviceIndex = 0;
  refreshBadge();

  if (roninOpen) return;   // he is already talking; do not interrupt himself

  if (type === 'success') playRonin(Math.random() < 0.5 ? 'attack' : 'slash');
  else if (type === 'error') playRonin('dodge');

  const lines = RONIN_REACTIONS[type] || RONIN_REACTIONS.info;
  const line = lines[Math.floor(Math.random() * lines.length)];

  /* A one-line aside uses the panel too, but closes itself. */
  roninPanel.hidden = false;
  roninRoot.dataset.open = 'aside';
  roninPanel.querySelector('.ronin__title').textContent = line;
  roninPanel.querySelector('.ronin__body').textContent = '';
  roninPanel.querySelector('.ronin__go').hidden = true;
  roninPanel.querySelector('.ronin__next').hidden = true;

  clearTimeout(roninHideTimer);
  roninHideTimer = setTimeout(() => {
    if (!roninOpen) { roninPanel.hidden = true; roninRoot.dataset.open = 'false'; }
  }, RONIN_REACTION_MS);
}

/* ==================================================================
   10. THE BADGE
   ================================================================== */

/** The client list as this page currently knows it. */
function roninClients() {
  return getClients() || [];
}

/**
 * Update the little count on his shoulder.
 *
 * Hidden entirely at zero rather than showing "0": a badge reading zero is
 * visual noise that trains people to ignore the badge.
 */
function refreshBadge() {
  if (!roninBadge) return;

  roninAdvice = buildAdvice(roninClients());
  const problems = countProblems(roninAdvice);

  roninBadge.textContent = String(problems);
  roninBadge.hidden = problems === 0;
  roninBadge.setAttribute('aria-label', `${problems} things need attention`);
}

/* ==================================================================
   11. THE TOUR
   ================================================================== */

/**
 * Whether this user has been shown the tour, and remembering that they have.
 *
 * Stored on the user's own record inside crm_users, NOT under a new
 * localStorage key. The assignment names exactly four keys and this app uses
 * exactly four; a fifth for a tutorial flag would break that for no good
 * reason. It also makes the flag per-account, which is the correct behaviour:
 * a second person registering on the same browser gets their own tour.
 */
function tourSeen() {
  const user = getCurrentUser();
  return !user || user.tourSeen === true;
}

function markTourSeen() {
  const user = getCurrentUser();
  if (!user) return;
  updateUser(user.id, { tourSeen: true });
}

/** The tour step for the page we are on, if the tour is still running. */
function tourStepForPage() {
  if (tourSeen()) return null;
  return RONIN_TOUR.find((step) => step.page === currentPage) || null;
}

/* ==================================================================
   12. BUILDING HIM
   ================================================================== */

function buildRonin() {
  roninRoot = document.createElement('div');
  roninRoot.className = 'ronin';
  roninRoot.dataset.open = 'false';

  /* --- The panel he speaks through --- */
  roninPanel = document.createElement('div');
  roninPanel.className = 'ronin__panel';
  roninPanel.hidden = true;
  roninPanel.setAttribute('role', 'status');
  roninPanel.setAttribute('aria-live', 'polite');

  const title = document.createElement('p');
  title.className = 'ronin__title';

  const body = document.createElement('p');
  body.className = 'ronin__body';

  const actions = document.createElement('div');
  actions.className = 'ronin__actions';

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn--sm ronin__go';
  go.hidden = true;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn--ghost btn--sm ronin__next';
  next.textContent = 'Next';
  next.hidden = true;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'ronin__dismiss';
  dismiss.textContent = '✕';
  dismiss.setAttribute('aria-label', 'Close the assistant');

  actions.append(go, next);
  roninPanel.append(dismiss, title, body, actions);

  /* --- The character himself, as a real button --- */
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ronin__btn';
  button.setAttribute('aria-label', 'RONIN, your assistant. Activate for the state of your client list.');
  button.setAttribute('aria-expanded', 'false');

  roninCanvas = document.createElement('canvas');
  roninCanvas.className = 'ronin__canvas';
  roninCanvas.width = RONIN_DRAW_W;
  roninCanvas.height = RONIN_DRAW_H;
  roninCanvas.setAttribute('aria-hidden', 'true');

  roninCtx = roninCanvas.getContext('2d');

  /* No 2-D context: some privacy modes block canvas entirely and a headless
     environment may have no backend at all. He is an extra, so leave quietly
     rather than throw and take the page's other scripts down with him. */
  if (!roninCtx) return false;

  /* The sheet is pixel art. Without this the browser smooths it when scaling
     and every hard edge turns to mush. */
  roninCtx.imageSmoothingEnabled = false;

  roninBadge = document.createElement('span');
  roninBadge.className = 'ronin__badge';
  roninBadge.hidden = true;

  button.append(roninCanvas, roninBadge);
  roninRoot.append(roninPanel, button);
  document.body.appendChild(roninRoot);

  /* --- Wiring --- */

  button.addEventListener('click', () => {
    toggleRonin();
    button.setAttribute('aria-expanded', String(roninOpen));
  });

  dismiss.addEventListener('click', () => {
    if (roninTourStep) { markTourSeen(); roninTourStep = null; }
    closeRonin();
    button.setAttribute('aria-expanded', 'false');
  });

  next.addEventListener('click', nextAdvice);

  go.addEventListener('click', () => {
    /* He runs off to fetch it. The navigation waits for the run to be visible,
       or the animation would be replaced by the new page before anyone saw it. */
    playRonin('run');
    if (roninTourStep && !RONIN_TOUR.find((s) => s.page === currentPage)?.go) markTourSeen();
    const href = go.dataset.href;
    setTimeout(() => { window.location.href = href; }, 320);
  });

  /* Escape closes him, like every other dismissible thing on the page. */
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && roninOpen) {
      closeRonin();
      button.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('crm:toast', handleRoninEvent);

  /* The client list arriving from the API for the first time. Without this he
     would have decided there was nothing to report before the data existed,
     and gone on saying so. */
  document.addEventListener('crm:clients-loaded', refreshBadge);

  return true;
}

/* ==================================================================
   13. START-UP
   ================================================================== */

/**
 * Wake him up once the sheet has arrived.
 *
 * Nothing can be drawn until the image has finished loading — a canvas asked
 * to draw an incomplete image silently draws nothing at all, with no error. So
 * the whole character waits on the load event rather than assuming the file is
 * ready.
 *
 * If the sheet fails to load he removes himself entirely rather than leaving
 * an empty box in the corner, and the app carries on without him.
 */
function setUpRonin() {
  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A character who walks, breathes and swings a sword is exactly the kind of
     decorative movement this setting exists to switch off. The information he
     carries is all available on the analytics page without him. */
  if (prefersReducedMotion) return;

  if (buildRonin() === false) return;

  roninSheet = new Image();

  roninSheet.onload = () => {
    roninEntrance();
    refreshBadge();

    roninTourStep = tourStepForPage();
    if (roninTourStep) {
      setTimeout(() => {
        if (!roninOpen) openRonin();
      }, RONIN_TOUR_DELAY_MS);
    }
  };

  roninSheet.onerror = () => {
    console.warn('RONIN: sprite sheet could not be loaded; continuing without him.');
    roninRoot.remove();
    roninRoot = null;
  };

  roninSheet.src = RONIN_SHEET_SRC;
}

/* Same contract as every other page script: stay out of the way entirely if
   the auth guard is already sending this visitor somewhere else. */
if (!isRedirecting) {
  document.addEventListener('DOMContentLoaded', setUpRonin);
}
