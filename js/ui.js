/**
 * ui.js — shared interface helpers used by every page.
 *
 * Three groups of things live here:
 *   1. Validation rules  — so signup, add-client and profile cannot disagree
 *   2. Feedback          — toasts and inline field errors (assignment P0.4)
 *   3. Formatting        — money, dates, initials, and HTML escaping
 *
 * Loaded after storage.js, before any page script.
 */

/* ------------------------------------------------------------------
   Tunable rules

   Deliberately named constants at the top of the file rather than numbers
   buried inside the validation functions. Changing the minimum password
   length is then a single edit here that every form picks up at once.
   ------------------------------------------------------------------ */

const MIN_NAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;
const MIN_PHONE_LENGTH = 6;
const TOAST_DURATION_MS = 3000;

/* ------------------------------------------------------------------
   Validation
   ------------------------------------------------------------------ */

/**
 * A usable email address: something, then "@", then a dot after the "@".
 *
 * Written as three explicit checks rather than one long regular expression,
 * because this version can be read aloud and matches the assignment's rule
 * exactly ("contains @ and a dot after the @").
 */
function isValidEmail(value) {
  const email = String(value).trim().toLowerCase();
  const at = email.indexOf('@');

  if (at < 1) return false;                       // must have text before "@"
  const domain = email.slice(at + 1);
  if (!domain.includes('.')) return false;        // must have a dot after "@"
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (email.includes(' ')) return false;

  return true;
}

/**
 * Password rule: long enough, and containing at least one letter and one digit.
 *
 * .test() returns true or false for "does this pattern appear anywhere in the
 * string", which is exactly the question being asked.
 */
function isValidPassword(value) {
  const password = String(value);
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  if (!/[a-zA-Z]/.test(password)) return false;   // at least one letter
  if (!/[0-9]/.test(password)) return false;      // at least one digit
  return true;
}

/** Trim first, then measure — "  ab  " is a 2-character name, not a 6. */
function isLongEnough(value, minimum) {
  return String(value).trim().length >= minimum;
}

/** A positive number. Number("") is 0 and Number("abc") is NaN, so both fail. */
function isPositiveNumber(value) {
  const number = Number(value);
  return !isNaN(number) && number > 0;
}

/* ------------------------------------------------------------------
   Inline field errors (assignment P0.4)

   Each field in the HTML looks like this:

     <div class="field">
       <label class="field__label" for="email">Email</label>
       <input class="input" id="email">
       <p class="field__error" data-error-for="email"></p>
     </div>

   setFieldError puts red text in the <p> and a red border on the input.
   clearFieldErrors wipes every error in a form before re-validating, so
   messages that no longer apply disappear on the next submit.
   ------------------------------------------------------------------ */

function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const slot = document.querySelector(`[data-error-for="${inputId}"]`);

  if (input) input.classList.add('input-error');
  if (slot) slot.textContent = message;
}

function clearFieldError(inputId) {
  const input = document.getElementById(inputId);
  const slot = document.querySelector(`[data-error-for="${inputId}"]`);

  if (input) input.classList.remove('input-error');
  if (slot) slot.textContent = '';
}

/** Reset every error inside one form. Called at the start of each submit. */
function clearFieldErrors(form) {
  form.querySelectorAll('.input-error').forEach((input) => {
    input.classList.remove('input-error');
  });
  form.querySelectorAll('.field__error').forEach((slot) => {
    slot.textContent = '';
  });
}

/**
 * Clear a field's error as soon as the user starts fixing it.
 *
 * The assignment lists live clearing as a bonus. Waiting until the next submit
 * to remove a message the user is already correcting feels broken.
 */
function enableLiveErrorClearing(form) {
  form.addEventListener('input', (event) => {
    if (event.target.classList.contains('input-error')) {
      clearFieldError(event.target.id);
    }
  });
}

/* ------------------------------------------------------------------
   Toasts (assignment P0.4)

   Green for success, red for errors, gone after 3 seconds or when the X is
   pressed. The assignment forbids browser alert() for messages, and alert()
   would also block the whole page until dismissed.
   ------------------------------------------------------------------ */

const TOAST_ICONS = {
  success: '✓',  // ✓
  error: '!',
  info: '⏰',     // ⏰
};

/** Create the fixed bottom-right container the first time a toast is shown. */
function getToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    /* Announces new toasts to screen readers without stealing focus. */
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * Show a message. `type` is "success", "error" or "info".
 *
 * The message is set with textContent, never innerHTML — toasts carry client
 * names that a user typed, and textContent makes the browser treat them as
 * text rather than markup to run.
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.style.setProperty('--toast-duration', `${TOAST_DURATION_MS}ms`);

  const icon = document.createElement('span');
  icon.className = 'toast__icon';
  icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;

  const text = document.createElement('span');
  text.className = 'toast__msg';
  text.textContent = message;

  const close = document.createElement('button');
  close.className = 'toast__close';
  close.type = 'button';
  close.textContent = '✕';  // ✕
  close.setAttribute('aria-label', 'Dismiss notification');

  const bar = document.createElement('span');
  bar.className = 'toast__bar';

  toast.append(icon, text, close, bar);
  getToastStack().appendChild(toast);

  /* Remove after the timeout, or immediately if the X is pressed. Clearing the
     timer on manual close stops it firing later against an element that is
     already gone. */
  const timer = setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  close.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
  });

  /*
    Announce it, so anything else that cares can react.

    A custom event is how one part of a page tells the rest that something
    happened without needing to know who is listening. The assistant uses this
    to draw his sword when an action succeeds. Calling him directly from here
    would mean ui.js had to know he exists; this way it does not, he can be
    deleted without touching a line of this file, and anything added later can
    listen to the same event.
  */
  document.dispatchEvent(new CustomEvent('crm:toast', {
    detail: { message, type },
  }));

  return toast;
}

/* ------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------ */

/** 5000 -> "$5,000" */
function formatMoney(amount) {
  return `$${Number(amount).toLocaleString('en-US')}`;
}

/** ISO timestamp -> "22/07/2026" in the reader's local format. */
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString();
}

/** ISO timestamp -> "22/07/2026, 14:22:07". Used for note timestamps. */
function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString();
}

/**
 * "Emily Johnson" -> "EJ". Used for the avatar when there is no image.
 * filter(Boolean) drops empty strings caused by double spaces.
 */
function getInitials(fullName) {
  return String(fullName)
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/** "Emily Johnson" -> "Emily". Used by the dashboard greeting. */
function getFirstName(fullName) {
  return String(fullName).trim().split(' ')[0];
}

/* ==================================================================
   Avatar uploads
   ================================================================== */

/*
  THE PROBLEM THIS SOLVES

  localStorage holds about 5MB, and it holds TEXT. An image has to be stored
  as a base64 data URL, which is roughly a third larger than the original
  file. A single photo straight off a phone is 3-5MB, so storing one unchanged
  would consume the entire budget and every write after it would fail — not
  just the picture, but saving a client or changing your password.

  So nothing is ever stored at the size it arrived. Every upload is drawn onto
  a canvas at 128x128 and re-encoded as JPEG first. Avatars display at 48px on
  a card and 72px on the profile page, so 128 is already sharper than needed
  even on a high-density screen, and the result is about 6KB of base64.

  Thirty-one images at that size is roughly 190KB — under 4% of the budget.
  The ceiling stops being something to manage and becomes something you cannot
  reach by normal use.
*/
const AVATAR_STORED_SIZE = 128;
const AVATAR_JPEG_QUALITY = 0.72;

/* A sanity limit on what is even worth decoding. This is about the ORIGINAL
   file: anything past this is almost certainly not a portrait, and decoding a
   60-megapixel image to throw away all but 128x128 of it wastes memory. */
const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Turn a chosen file into a small square JPEG data URL.
 *
 * Returns a promise because two separate asynchronous steps are involved and
 * neither can be skipped: FileReader has to finish reading the bytes, and then
 * the browser has to finish decoding those bytes into an image before its
 * width and height are known. Both report completion through events, so the
 * promise is what lets the caller simply await the finished result.
 *
 * The crop is centred and "cover" style: the shorter side is used as the
 * square, so a portrait photo keeps its middle rather than being squashed.
 */
function readImageAsAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('image/')) {
      reject(new Error('That file is not an image'));
      return;
    }

    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      reject(new Error('That image is too large. Please pick one under 8MB'));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Could not read that file'));

    reader.onload = () => {
      const image = new Image();

      /* A file can claim to be an image in its type and still not decode —
         a renamed text file, or a truncated download. */
      image.onerror = () => reject(new Error('That image could not be opened'));

      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_STORED_SIZE;
        canvas.height = AVATAR_STORED_SIZE;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image processing is unavailable in this browser'));
          return;
        }

        /* Centre-crop to a square before scaling down. */
        const side = Math.min(image.width, image.height);
        const sourceX = (image.width - side) / 2;
        const sourceY = (image.height - side) / 2;

        context.drawImage(
          image,
          sourceX, sourceY, side, side,
          0, 0, AVATAR_STORED_SIZE, AVATAR_STORED_SIZE
        );

        /* JPEG rather than PNG: a photograph as PNG is several times larger
           for no visible gain at this size. Transparency is not needed,
           because the result is always a filled square. */
        resolve(canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Build an avatar element: the image if there is one, initials if not.
 *
 * Every place in the app that shows an avatar goes through here, so the
 * fallback rule and the alt text are decided once. Previously the clients page
 * and the profile page each built their own and could have disagreed.
 */
function createAvatar(imageSrc, nameForInitials, extraClass = '') {
  if (imageSrc) {
    const img = document.createElement('img');
    img.className = `avatar ${extraClass}`.trim();
    img.src = imageSrc;
    img.alt = '';            // decorative: the name is always beside it
    img.loading = 'lazy';
    return img;
  }

  const initials = document.createElement('div');
  initials.className = `avatar avatar--initials ${extraClass}`.trim();
  initials.textContent = getInitials(nameForInitials);
  return initials;
}

/**
 * Make a string safe to put inside an HTML template.
 *
 * Client names, companies and notes come from the API and from free text the
 * user types. Dropping them straight into an HTML string would let a name like
 * <img src=x onerror=alert(1)> run as code for anyone who later views that
 * client — and because the client list is saved, it would run again on every
 * future visit, not just once.
 *
 * All five characters are replaced explicitly. The obvious shortcut is to set
 * the value as textContent and read innerHTML back, letting the browser escape
 * it — but that only escapes &, < and >, because quotes are not special in
 * ordinary text. It would leave this wide open:
 *
 *     <img alt="${escapeHtml(name)}">
 *
 * with a name of  " onerror="...  , which contains no &, < or > at all, so the
 * shortcut returns it untouched, the quote closes the alt attribute, and the
 * injected handler becomes real. Escaping the quotes closes that hole.
 *
 * Most rendering in this project builds elements with createElement and sets
 * textContent, which is safe automatically. This helper is for the few places
 * that build markup as a string.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')   // must run first, or it double-escapes the rest
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
