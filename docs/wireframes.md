# Vault — wireframes & how it works

A visual walkthrough of every surface. Each wireframe is the real layout shipped in `frontend/`.

## App shell

```
┌───────────┬──────────────────────────────────────────────────────────┐
│  ☰ Vault  │  Saving…                                    🔔(3)   (Y)  │
│           │  ────────────────────────────────────────────────────── │
│ ＋ Quick   │                                                          │
│   add   C │                    ACTIVE VIEW                           │
│           │                                                          │
│ 🏠 Dash    │   (Dashboard / Section list / Boards / Finance /        │
│ ▥ Projects │    To-dos / Graph / Tags / Settings dialogs)            │
│ ▦ Finance  │                                                          │
│ ☑ To-dos   │                                                          │
│ ⌗ Graph    │                                                          │
│ ✎ Notes  6 │                                                          │
│ ▶ YouTube 3│                                                          │
│ ▤ Library 2│                                                          │
│ ❏ Docs   6 │                                                          │
│ 🏷 Tags    │                                                          │
│ ⌕ Search ⌘K│                                                          │
│ ✦ Ask AI   │                                                          │
│ ⌫ Trash  1 │                                                          │
└───────────┴──────────────────────────────────────────────────────────┘
Sidebar collapses to a 56px icon rail; every icon 19px (21px in rail).
All single keys + G-chords are user-rebindable (Settings → Preferences).
```

## Dashboard — "visualize first"

```
┌ OVERVIEW · date ─────────────────────────────────────────────┐
│ Your collection, at a glance                                  │
│ ┌ Getting started 2/5 ────────────── (first-run only) ──────┐ │
│ └─────────────────────────────────────────────────────────── ┘ │
│ ┌ Your week 🔥streak ┐ ┌ Items/week ▂▃▅ ┐                     │
│ │ ▂▁▃▁▂▆▇  M T W …   │ │ bars, 8 weeks   │                    │
│ └────────────────────┘ └─────────────────┘                    │
│ ┌ Where things live ◔┐ ┌ Where money goes ┐                   │
│ │ donut + legend      │ │ top-4 category bars│                 │
│ └────────────────────┘ └───────────────────┘                  │
│ ┌ Most used · last 30 days ── 6 ranked feature bars ────────┐ │
│ └────────────────────────────────────────────────────────────┘ │
│ [ Search everything… ( / ) ]                                   │
│ ┌Notes 6┐┌YouTube 3┐┌Library 2┐┌Docs 6┐   ← section tiles      │
│ ┌ 5 insight cards: Reading/Watching/To-dos/Money/Boards ─────┐ │
│ ┌ ✦ Weekly digest (AI) ───────────────────────────────────── ┐ │
└────────────────────────────────────────────────────────────────┘
```

## Quick capture (C)

```
┌──────────────────────────────────────────────┐
│ Type or paste anything…                      │
│ ──────────────────────────────────────────── │
│ SAVE AS [YouTube][Cloud file][Link][Expense] │
│         [To-do][Note]   ← auto-routed, hint  │
│ "due 2026-08-21 · ⚑ priority · #tag · ↵"     │
└──────────────────────────────────────────────┘
Heuristics: URL kind, money amounts+category, date words, #tags.
```

## Notes (list · grid · page)

```
List row: [icbox] Title  #tags ＋tag  ✎blocks ⤢page   ADDED·stamp ✕
Grid:     cards with first-line preview (Notes only)
Page:     ← Back | 👁 Read  ✎ Edit
          Title / folder / tags / editable stamp
          [＋zones between every block] heading·text·todo·bullet·
          table·image·sub-page   ✦AI: summarize/actions/continue
```

## To-dos

```
[input: "call mom tomorrow ⚑"] [today|tomorrow|custom] [⚑] [Add]
☰ List | Day | Week | ▦ Month | Year        📅 Import calendar
  Overdue ▸ Today ▸ Upcoming ▸ Someday ▸ Done(collapsible)
  Month grid: task chips + 📅 event chips from imported .ics
  📈 Your pace (collapsed): done-per-week bars
```

## Boards (Jira-style)

```
Tabs: [▦ Vault items][Feature: Vault backend][+ New board]
Sprint bar: [Sprint 2 ▾] 4 tasks · 1 done · 4.5h  [＋New sprint]
            [✓Complete sprint→rolls unfinished to Backlog] [⬇CSV]
Columns:  Backlog | In progress | Done(⏱hours chips)
Card:     Title / FVB-3 / labels ≡ / ✕     click → modal:
          [FVB-3] 👁Read ✎Edit  [status▾]  sprint▾ ⏱hours #labels
          description textarea
```

## Finance

```
Stat tiles: Spent today / month / Pending / Income / Saved / Paid
Tabs: [▥ Board][⧗ Bills & Budgets][◔ Analytics]  [⬇ CSV]
Board: daily expenses (cat·desc·paychip·amount ✎ ✕) + add form
       [what][amount][category▾][paid with▾][+ Add]  ✦ smart add
Bills: Upcoming | Due soon | Paid  (recurring auto-reschedules)
       💳 Payment methods manager + per-method month bars
       Budgets (caps + bars) · Savings goals (+contributions)
Analytics: [Daily|Weekly|Monthly|Yearly] × [Bar|Line|Area|Donut]
```

## Graph · Tags · Reports · Settings

```
Graph: live force sim; tags=hubs, items orbit; drag/zoom/search.
Tags:  [＋ Create a tag…] grid of tag cards (new = dashed + ✕).
Reports: dialog → per-feature or full-vault printable HTML.
Settings: account header / profile / preferences(+⌨ rebind all
          16 shortcuts, collapsible) / AI (Claude or open-source,
          key never re-rendered) / connected apps / your data.
```
