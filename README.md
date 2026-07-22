# 10X CRM

A customer relationship management app for sales managers, built in vanilla
JavaScript — no frameworks, no libraries, no build step.

## About

Sales managers track dozens of prospects at different stages: some have not been
contacted yet, some are mid-negotiation, some have closed or fallen through.
Following that in a spreadsheet is chaos. 10X CRM gives them one client database,
deal-stage management, notes as a relationship history, follow-up reminders, and
a dashboard summarising the state of the business.

The interface is styled as **"Cyber Chrome"** — Windows 2000 window chrome
rendered in cyber-futurist neon, with pixel-art detailing. The pastiche does
structural work rather than decoration: a modal genuinely is a window with a
title bar, the navigation genuinely is a taskbar, and the pipeline chart is
shaped like a retro game's health bar.

Three visual layers share the screen and each has a defined job, so none of them
swallows the others: **chrome** owns panels, buttons and cards; **neon bloom**
owns accents, focus and headings; **pixel art** owns icons, the display font and
the assistant. Behind all of it, digital rain falls in half-width katakana.

## Live Demo

**https://10x-crm-eta.vercel.app**

## Test Account

The app creates a demo account automatically on first visit, so there is no need
to register in order to look around:

| Email | Password |
|---|---|
| `demo@test.com` | `demo1234` |

Registering a new account works normally too. Data is stored per browser, so a
fresh browser starts with the demo account and the original 30 clients.

## Features

### Accounts
- Registration with six validation rules, all reported together on one submit
- Login with a deliberately generic failure message, so the app never reveals
  which email addresses are registered
- Route protection: the four private pages cannot be opened without a session,
  and a logged-in visitor is redirected away from the login page
- Logout closes the session without deleting any data

### Clients
- Loads 30 clients from the DummyJSON API on first run, then works from local
  storage so your edits are never overwritten
- Add, edit and delete clients, with validation and confirmation
- Change a deal's stage directly from its card
- Search by name or company, filter by stage, and sort by date, name or deal
  value — all three combine
- Client details with a running history of dated notes
- A photo per client, uploaded from your machine and shrunk before it is stored
- "Remind me in 1 min" follow-up notification, which still fires after the
  window is closed
- Loading, empty and error states, with a working Retry when the connection fails

### Dashboard
- Personalised greeting and a clock that updates every second
- Four live statistics: total clients, active deals, won revenue, new this week
- Pipeline chart showing the spread of deals across the four stages
- The five most recently added clients

### Analytics
A diagnostic board in the style of an old server terminal. The dashboard says
what **is**; this page says what is **wrong**, and it is deliberately not a
second dashboard:

- A scan that reads your data and reports findings, worst first — deals nobody
  has touched in two weeks, deals open more than twice your usual cycle, and
  revenue concentrated in a single client
- Each finding names the actual clients, so it can be acted on
- A conversion funnel: not how many deals sit in each stage, but the percentage
  lost moving between them
- A revenue forecast — open pipeline cut down by your real win rate, because a
  pipeline total on its own is a wish
- Export the whole CRM to a JSON file and load it back in. The export contains
  no password and no email address

### Profile
- Account details with an avatar generated from your initials
- Upload a profile photo, resized to 128px and stored inside your account record
- Edit your name and company
- Change your password, with the old one required
- Reset the client database without touching your account

### Extras
- Dark and light themes, remembered between visits
- Keyboard shortcuts — press `?` on the Clients page to see them
- Responsive layout
- **RONIN**, a pixel-art samurai who is an actual assistant rather than a mascot:
  he carries a live count of things that need attention, and clicking him names
  the single most urgent problem and the client it concerns, with a button that
  opens exactly that client. New accounts get a short guided tour
- Digital rain behind every page, drawn on a canvas in half-width katakana
- An easter egg. It is a keyboard sequence every gamer knows.
- Every animation stops for anyone whose system asks for reduced motion

## Tech Stack

- **HTML5** — six separate pages, no single-page-app routing
- **CSS3** — custom properties for theming, no preprocessor, no framework
- **Vanilla JavaScript (ES2020+)** — no React, no Vue, no jQuery, no dependencies
- **localStorage** — all persistence, no backend
- **[DummyJSON](https://dummyjson.com)** — the REST API the client database loads
  from, exercising GET, POST, PUT and DELETE
- **Vercel** — hosting, redeployed automatically on every push

### Project structure

```
index.html      Login              css/tokens.css       colours, fonts, spacing
signup.html     Registration       css/base.css         reset, page background
dashboard.html  Summary            css/components.css   buttons, cards, windows
clients.html    Client database    css/pages.css        per-page layout
analytics.html  Diagnostics
profile.html    Account            assets/ronin.png     the assistant's sprites

js/storage.js     the only file that touches localStorage
js/ui.js          validation rules, notifications, formatting, photo resizing
js/app.js         route protection, theme, shared navigation, the easter egg
js/data.js        API calls, caching, filtering, sorting, the diagnosis engine
js/auth.js        registration and login
js/clients.js     the client list
js/dashboard.js   the statistics
js/analytics.js   the diagnostics, the funnel, JSON export and import
js/profile.js     the account page
js/atmosphere.js  the digital rain
js/assistant.js   RONIN — the badge, the advice, the tour
```

The diagnosis engine lives in `data.js` rather than on the analytics page
because **two** features need it: the analytics board renders it as a report,
and RONIN speaks the most urgent line of it on every page. One copy of the
rules means the assistant can never contradict the page.

## How to Run

No dependencies and no build step.

```bash
git clone https://github.com/sunnyisabunny/10x-crm-sunnyisabunny.git
cd 10x-crm-sunnyisabunny
```

Then either open `index.html` directly in a browser, or serve the folder:

```bash
pnpm dlx serve .      # or: python -m http.server 8765
```

Both work. The project deliberately avoids JavaScript modules so that opening
the files directly still works, which means the app can be demonstrated without
an internet connection once the clients have loaded once.

## A note on security

Passwords are stored as readable text in the browser, and the route protection
can be bypassed with developer tools. **Both would be unacceptable in a real
product**, and both are unavoidable here: the assignment specifies no backend,
which means all of the code and all of the data sit on the visitor's own
computer. Hashing passwords in the browser would be *theatre* — an attacker
reading the same JavaScript can run the same hash — and would arguably be worse
than nothing, because the stored hash would itself become the credential.

But not everything here is a compromise. The defences against cross-site
scripting, the allowlist on imported files, the credentials left out of every
export and the coercion of URL parameters are **real** and would still be real
with a server behind them.

**[`SECURITY.md`](SECURITY.md) explains all eight decisions in plain English** —
what each one is, why it is like that here, and what changes when there is a
server. Each is also marked in the code it governs, as
`SECURITY DECISION 1`…`8`, so the file and the source can be read side by side.

## Documentation

- [`SECURITY.md`](SECURITY.md) — every security decision, and what a real product does instead
- [`ai-log.md`](ai-log.md) — how AI was used, including what was rejected and why
- [`glossary.md`](glossary.md) — 10 technical terms from this project
- [`research-note.md`](research-note.md) — the English source used and what it changed

## Credits

- Built by **[sunnyisabunny](https://github.com/sunnyisabunny)** as the final
  project for the 10X JavaScript module.
- Developed with **Claude Code (Opus 4.8)** as a pair-programming assistant.
  Every design decision, rejection and correction is recorded in
  [`ai-log.md`](ai-log.md).
- Client data from [DummyJSON](https://dummyjson.com).
- Fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P),
  [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) and
  [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono).
