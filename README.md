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

## Live Demo

**https://REPLACE-WITH-DEPLOYED-URL.vercel.app**

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
- Route protection: the three private pages cannot be opened without a session,
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
- "Remind me in 1 min" follow-up notification, which still fires after the
  window is closed
- Loading, empty and error states, with a working Retry when the connection fails

### Dashboard
- Personalised greeting and a clock that updates every second
- Four live statistics: total clients, active deals, won revenue, new this week
- Pipeline chart showing the spread of deals across the four stages
- The five most recently added clients

### Profile
- Account details with an avatar generated from your initials
- Edit your name and company
- Change your password, with the old one required
- Reset the client database without touching your account

### Extras
- Dark and light themes, remembered between visits
- Keyboard shortcuts — press `?` on the Clients page to see them
- Responsive layout
- An easter egg. It is a keyboard sequence every gamer knows.

## Tech Stack

- **HTML5** — five separate pages, no single-page-app routing
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
profile.html    Account

js/storage.js     the only file that touches localStorage
js/ui.js          validation rules, notifications, formatting
js/app.js         route protection, theme, shared navigation
js/data.js        API calls, caching, filtering and sorting
js/auth.js        registration and login
js/clients.js     the client list
js/dashboard.js   the statistics
js/profile.js     the account page
```

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
product.** They are unavoidable here because the assignment specifies no backend,
and there is no point hashing passwords in the browser — an attacker reading the
same JavaScript can run the same hash, so it would be theatre rather than
security. Real systems store a slow salted hash on a server and enforce access
there, because the client is attacker-controlled by definition. This is explained
in more detail in the comments in `js/storage.js`.

## Documentation

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
