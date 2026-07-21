# 10X CRM

A customer relationship management app for sales managers, built in vanilla
JavaScript with no frameworks, no libraries and no build step.

> **Status:** in development. This README is completed as the project is built —
> see the checklist at the bottom for what is finished so far.

## About

Sales managers track dozens of prospects at different stages: some have not been
contacted yet, some are mid-negotiation, some have closed or fallen through.
Following that in a spreadsheet is chaos. 10X CRM gives them one database of
clients, deal-stage management, notes as a relationship history, follow-up
reminders, and a dashboard that summarises the state of the business.

## Tech Stack

- **HTML5** — five separate pages, no single-page-app routing
- **CSS3** — custom properties for theming, no preprocessor, no framework
- **Vanilla JavaScript (ES2020+)** — no React, no Vue, no jQuery
- **localStorage** — all persistence, no backend
- **[DummyJSON](https://dummyjson.com)** — the REST API the initial client
  database is loaded from

## Live Demo

_Coming soon._

## Test Account

_Coming soon._

## How to Run

The project has no dependencies and no build step.

```bash
git clone https://github.com/sunnyisabunny/10x-crm-sunnyisabunny.git
cd 10x-crm-sunnyisabunny
```

Then either open `index.html` directly in a browser, or serve the folder over
HTTP:

```bash
pnpm dlx serve .
```

## Credits

_Coming soon._

---

## Build progress

- [x] Design system (tokens, components, screens)
- [ ] P0 — Global rules: auth guard, navigation, theme, notifications
- [ ] P1 — Sign Up
- [ ] P2 — Login
- [ ] P3 — Dashboard
- [ ] P4 — Clients
- [ ] P5 — Profile
- [ ] Deployment
