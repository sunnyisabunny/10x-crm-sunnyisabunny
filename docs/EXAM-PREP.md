# Exam preparation — 10X CRM

This file is study material, not part of the product. It exists because one of
the five graded criteria is **technical analysis**: explaining your own code,
out loud, without AI help.

Read it top to bottom once, then use the rapid-fire section to test yourself.
Everything here describes code that is actually in this repository — if an
answer here disagrees with the code, the code wins, so go and look.

---

## 1. The one-minute English speech

> 10X CRM is a customer relationship management app for sales managers. A sales
> manager has dozens of prospects at different stages, and following them in a
> spreadsheet becomes chaos very quickly. My app gives them one client database,
> deal-stage management, notes as a relationship history, follow-up reminders,
> and a dashboard that summarises the state of the business.
>
> It is built in vanilla JavaScript — no frameworks, no libraries, and no build
> step. There are five pages. Accounts and clients are stored in localStorage,
> and the client list is loaded once from the DummyJSON REST API using GET,
> POST, PUT and DELETE.
>
> The interface is a Windows 2000 pastiche rendered in neon, which I chose
> because the retro window metaphor does real structural work: a modal genuinely
> is a window with a title bar, and the navigation genuinely is a taskbar.
>
> The part I am most pleased with is that all the shared logic lives in exactly
> one place. Only one file touches localStorage, only one function decides where
> clients come from, and the four deal stages are declared once — so adding a
> fifth stage is a single line.

Practise this until it takes about 55 seconds. Do not memorise it word for word;
memorise the four beats — **problem, stack, design choice, engineering pride.**

---

## 2. Architecture — the questions they will actually ask

### Why classic `<script>` tags instead of ES modules?

Three reasons, and the first is the real one:

1. **Modules break under `file://`.** Browsers apply CORS rules to module
   loading, so double-clicking `index.html` from a folder fails. With classic
   scripts I can demo this project with no server and no internet.
2. **No build step.** The assignment forbids frameworks and bundlers, so a
   toolchain would be an odd thing to add.
3. **Explicit load order.** Each page lists its scripts in dependency order, so
   it is obvious what depends on what.

**The follow-up you must be ready for — "then how do the files see each
other?"** Because a top-level `const` in a classic script goes into the shared
global lexical environment of the document, not into a per-file scope. Every
script in the same page sees it. That is exactly why `isRedirecting` in
`js/app.js` is readable from `js/clients.js`. With modules, each file gets its
own scope and you would have to import explicitly.

The trade-off, honestly stated: everything is global, so name collisions are a
real risk. I manage that with distinct prefixes and by keeping one clear owner
per concern.

### The file layout

| File | Owns |
|---|---|
| `js/storage.js` | **The only file that touches `localStorage`** |
| `js/ui.js` | Validation rules, toasts, field errors, formatting |
| `js/app.js` | Auth guard, theme, shared navigation — runs on all five pages |
| `js/data.js` | API calls, cache-or-API loading, filter/search/sort |
| `js/auth.js` | Signup and login |
| `js/clients.js` | The client list |
| `js/dashboard.js` | The statistics |
| `js/profile.js` | The account page |

If asked *"why is `storage.js` the only file that touches localStorage?"* — so
that the four key names exist in exactly one place. If a second file wrote
`crm_clients` directly and I later renamed the key, I would have to find every
copy. One owner means one edit.

---

## 3. Storage

Four keys, all declared in `STORAGE_KEYS` in `js/storage.js`:

| Key | Holds |
|---|---|
| `crm_users` | Array of registered accounts |
| `crm_session` | Who is logged in right now |
| `crm_clients` | The client database |
| `crm_theme` | `"dark"` or `"light"` |

**Why `localStorage` and not `sessionStorage` or cookies?**
`sessionStorage` is wiped when the tab closes, so you would be logged out every
time — wrong for a CRM you return to. Cookies are sent to a server on every
request, and there is no server here, so they would be pure overhead. I need
data that persists across visits and stays on the client. That is exactly
`localStorage`.

**Why does `getClients()` return `null` and not `[]` when nothing is saved?**
This is my favourite detail and a great thing to volunteer. `null` means *never
loaded — go and fetch*. `[]` means *loaded, and the user deleted everyone*. If
both were `[]`, deleting your last client would look identical to a fresh
install, and the app would silently re-download the original thirty people you
had just got rid of.

**What does logout delete?** Only `crm_session`. Accounts and clients survive,
because logging out is not deleting your data.

**`JSON.stringify` / `JSON.parse`** — localStorage stores strings only, so
objects are converted to text on the way in and back to objects on the way out.
`JSON.parse` throws if the text is corrupted, so `readJSON()` wraps it in
`try/catch`.

---

## 4. The API — where most questions land

### What `await` actually does

`await` pauses **this function** until the promise settles, and hands control
back to the browser in the meantime. It does **not** block the page. The UI stays
responsive, the spinner keeps spinning. When the promise resolves, the function
resumes on the next line.

I used `async/await` over `.then()` chains because the success path then reads
top to bottom like ordinary code.

### `response.ok` — the classic trap

```js
const response = await fetch(`${API_BASE}?limit=${API_CLIENT_LIMIT}`);
if (!response.ok) throw new Error(`API responded with ${response.status}`);
```

**`fetch` only rejects when the request could not be made at all** — no network,
DNS failure. A 404 or a 500 is a *successful round trip* as far as `fetch` is
concerned: the server was reached and it answered. So without the explicit
check, a server error page would sail straight through and I would try to read
`data.users` out of it.

`response.ok` is simply `status` in the 200–299 range.

### The four methods

| Method | Where | Why that verb |
|---|---|---|
| `GET` | `fetchClientsFromApi()` | Read. It is `fetch`'s default, so it is not written out |
| `POST` | `createClientOnApi()` | Create something new |
| `PUT` | `updateClientOnApi()` | Replace a record that already exists |
| `DELETE` | `deleteClientOnApi()` | Remove |

**Why does an edit use PUT and not POST?** The method is how you tell a server
what kind of change this is. Against a real backend, sending POST for an edit
would create a duplicate instead of updating.

### Why is a 404 on DELETE treated as success?

DummyJSON *simulates* writes: it validates your request and sends back a proper
response, but stores nothing. So a client I added myself never really existed on
the server, and asking it to delete id 31 correctly answers "no such record".

The local list is the real source of truth. Refusing to delete something the
user can see, because a simulated backend disagreed, would be the wrong call.

### `loadClients()` — the rule the whole app turns on

```js
const cached = getClients();
if (cached !== null) return cached;        // saved data always wins
const clients = await fetchClientsFromApi();
saveClients(clients);
return clients;
```

The API is contacted **exactly once in the app's lifetime**. Any other rule and
every page reload would overwrite your edits with a fresh copy of the original
thirty records.

---

## 5. Rendering and events

### Why `getVisibleClients()` copies before sorting

```js
let visible = [...clients];
```

`sort()` reorders an array **in place** and returns the same array. Sorting the
stored list directly would permanently scramble it, so clearing a filter would
no longer restore the original order. `filter()` already returns a new array,
but the copy guarantees safety even when no filter is active.

Order is always: **status filter → search → sort.**

### Event delegation

One click listener sits on the list container, not one per card.

Cards are rebuilt from scratch on every redraw. Per-card listeners would need
re-attaching after each redraw, and any I missed would leak. Listening on the
parent and asking *what was clicked* survives any number of redraws. That is why
buttons carry `data-action` and cards carry `data-id`:

```js
const card = event.target.closest('[data-id]');
const action = event.target.dataset.action;
```

`data-*` attributes are the standard way to attach your own data to an element,
readable in JS through `element.dataset`.

### `preventDefault()`

The first line of every submit handler. A form's default behaviour is to send
the data to a URL and **reload the page** — which in a single-page-free vanilla
app means losing all in-memory state and having nothing handle the data. I want
to handle the submit in JavaScript instead, so I cancel the default.

### Why `textContent` and never HTML strings

Client names, companies and notes come from the API and from free text the user
types. Everything user-supplied is rendered with `createElement` and
`textContent`.

`textContent` makes the browser treat the value as **characters to display**,
not markup to run. A client named `<img src=x onerror=alert(1)>` shows up as
those literal characters. If I had built the card by assembling an HTML string
and assigning `innerHTML`, that would execute — and because the name is saved to
localStorage, it would execute again on every future visit. That is **stored
XSS**.

### Array methods used, and where

| Method | Where | What it gives back |
|---|---|---|
| `map` | `data.users.map(mapApiUserToClient)` | A new array, same length |
| `filter` | active deals, "new this week" | A new array, only what matched |
| `reduce` | won revenue | One value from many |
| `find` | looking a client up by id | The first match, or `undefined` |
| `some` | duplicate email check | `true` / `false` |

Won revenue is worth being able to recite:

```js
clients.filter((c) => c.status === 'Won')
       .reduce((sum, c) => sum + c.dealValue, 0);
```

The `0` is the starting value, so an empty list gives `0` rather than an error.

---

## 6. Auth — and the honest security answer

### How the guard works

`js/app.js` is loaded **in `<head>` and not deferred**, on purpose. If the guard
ran after the page had been drawn, opening `dashboard.html` while logged out
would flash the real dashboard on screen before bouncing to login. The theme is
applied there for the same reason — running late gives a visible flash of the
wrong colours.

Two symmetrical rules: no session on a protected page → login; a session on
login or signup → dashboard.

### `isRedirecting` — the bug worth telling them about

**Assigning to `window.location.href` starts a navigation. It does not stop the
current page.** The browser carries on parsing and running everything after it.

So the guard "worked" and still leaked: opening `clients.html` while logged out
did redirect, but on the way out it also ran `clients.js` in full — a GET to the
API, thirty clients written into localStorage, and the entire list rendered into
the DOM of a page the visitor was not allowed to see.

The fix: the guard publishes its verdict as `const isRedirecting`, and every
page script checks it before doing any work.

**Say that this was found by an end-to-end test in a real DOM, not by reading
the code.** It is true, and it is the kind of answer that shows real
understanding rather than recitation.

### Why are passwords stored in plain text?

Answer it in three parts, and do not be defensive:

1. **It would be unacceptable in a real product.** Say this first.
2. **It is unavoidable here.** The assignment specifies no backend. Hashing in
   the browser would be *theatre*: an attacker reading the same JavaScript can
   run the same hash function, so it protects nothing.
3. **What a real system does.** Stores a slow salted hash — bcrypt, scrypt,
   argon2 — on a **server**, and never lets the browser see it. Slow on purpose,
   so guessing millions of candidates is expensive. Salted so two users with the
   same password do not produce the same stored value.

The same logic covers the guard: it is convenience, not security. Anyone can
edit localStorage in DevTools. Real access control has to happen somewhere the
user cannot modify, which means a server.

### Why is the login error deliberately vague?

`Invalid email or password` is shown for both a wrong email and a wrong
password. If the app said "no account with that email", an attacker could feed
it a list of addresses and learn which ones are registered — that is **account
enumeration**. One message for both tells them nothing.

---

## 7. Theming

One attribute on `<html>`:

```js
document.documentElement.dataset.theme = theme;
```

Both themes in `css/tokens.css` declare the **same variable names** with
different values, so flipping that one attribute re-points every colour at once.
No component knows themes exist — they just use `var(--surface)`.

---

## 8. The live-change segment

You will be asked to make a small change with no AI. The likeliest asks, and the
one-line answer to each:

| If they ask | Change this |
|---|---|
| Minimum password length | `MIN_PASSWORD_LENGTH` in `js/ui.js:21` |
| Minimum name length | `MIN_NAME_LENGTH` in `js/ui.js:20` |
| Add a fifth deal stage | `CLIENT_STATUSES` in `js/data.js:23` + one colour in `tokens.css` |
| Reminder delay | `REMINDER_DELAY_MS` in `js/clients.js:23` |
| How many clients load | `API_CLIENT_LIMIT` in `js/data.js:29` |
| How many "recent" show | `RECENT_CLIENT_COUNT` in `js/dashboard.js:14` |
| Toast duration | `TOAST_DURATION_MS` in `js/ui.js:23` |
| Default theme | `DEFAULT_THEME` in `js/storage.js:21` |

The filter chips, the status dropdown on each card, the Add Client form and the
dashboard pipeline **all derive from `CLIENT_STATUSES`**. Nothing hardcodes the
four names anywhere else. Adding a stage really is one array entry plus one
colour token — demonstrate that if you get the chance.

---

## 9. Three real bugs — tell these stories

Being able to describe a bug you fixed is worth more than any amount of smooth
recitation.

**1. `form.name` returns the wrong thing.**
A form element already owns properties called `name`, `action`, `method` and
`target`. Those real properties **win** over the shortcut that looks a control
up by its `name` attribute. So `form.name.value` was `undefined` — and the
length check ran `String(undefined)`, which is the nine-character word
`"undefined"`, which *passes* a minimum-of-three check. The app would have
cheerfully saved a client literally called "undefined". Fixed by reading fields
through `form.elements` in both forms.

**2. The redirect that did not stop the page.** Covered in §6.

**3. DummyJSON hands out the same id every time.**
Every POST comes back as id 31, because nothing is really stored. Trusting it
would give several clients identical ids, and deleting one would delete all of
them. So the returned id is used only if it is genuinely free:

```js
const idIsFree = saved.id && !clients.some((c) => c.id === saved.id);
payload.id = idIsFree ? saved.id : Date.now();
```

---

## 10. Rapid fire

Cover the right column and answer out loud.

| Question | Answer |
|---|---|
| What does `await` do? | Pauses this function until the promise settles; does not block the page |
| Does `fetch` throw on 404? | No. Only when the request could not be made at all |
| What is `response.ok`? | `true` when status is 200–299 |
| Why check it? | An error page would otherwise be parsed as if it were data |
| What does `preventDefault()` stop? | The form submitting to a URL and reloading the page |
| Why `textContent` not `innerHTML`? | Prevents stored XSS from names and notes |
| Why copy before `sort()`? | `sort()` reorders in place and would scramble the stored list |
| Why one listener on the list? | Cards are rebuilt on every redraw; per-card listeners would leak |
| What is `data-id` for? | Identifies which client a clicked element belongs to |
| What does logout remove? | Only `crm_session` |
| `null` vs `[]` from `getClients()`? | `null` = never loaded; `[]` = user deleted everyone |
| Why is the login error vague? | Prevents account enumeration |
| Is the guard security? | No — convenience. Real access control needs a server |
| Why plaintext passwords? | No backend; browser hashing would be theatre. Real systems: salted slow hash, server-side |
| Why localStorage over sessionStorage? | `sessionStorage` dies with the tab; a CRM must persist |
| Why no ES modules? | They break under `file://`; also no build step, explicit load order |
| How do the files see each other? | Classic scripts share one global lexical scope |
| Difference between POST and PUT? | POST creates; PUT replaces something that exists |
| Why does DELETE 404 count as success? | The record never really existed server-side; local list is the truth |
| How does the theme work? | One `data-theme` attribute on `<html>`; both themes define the same variable names |
| What does `reduce`'s `0` do? | Starting value, so an empty list totals 0 |

---

## 11. Demo route — five minutes

Rehearse in this order. It hits every requirement without doubling back.

1. **Sign up** — submit empty first to show all six rules firing at once, then
   register properly. Toast, then redirect.
2. **Log in** — get it wrong once to show the generic error, then in.
3. **Dashboard** — greeting, live clock, four stats, pipeline bar, recent five.
4. **Clients** — search, filter, sort, all three combining. Open a card, add a
   note, set the reminder.
5. **Add a client** — show validation, then a real one. Open the **Network tab**
   and point at the POST.
6. **Edit** one — point at the PUT. **Delete** one — point at the DELETE.
7. **Profile** — rename yourself, then go back to the dashboard so the greeting
   has visibly changed.
8. **Theme toggle**, then **hard reload** to prove it persisted.
9. **Log out**, log back in — everything still there.
10. If there is time: the Konami code. `↑↑↓↓←→←→BA`

Have DevTools open on **Application → Local Storage** at some point and show the
four keys. It is direct evidence for a requirement they have to tick.
