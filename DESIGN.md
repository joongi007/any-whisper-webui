# DESIGN.md

> Visual system for `ui/`. Tokens here are the source of truth; `index.css`
> mirrors them. Per impeccable: OKLCH, neutrals tinted toward the brand hue,
> never pure `#000` / `#fff`.

## Color strategy

**Restrained** (per impeccable register=product, default tier). One accent
≤10% of any surface. Neutrals carry everything else.

### Brand hue

Single hue: **violet** at OKLCH `H = 295` (slightly cooler than 280, distinct
from the AI-cliché purples that crowd the 270–280 lane). Use it for:

- Primary buttons, focused inputs, links
- "active" / "playing" segment background tint
- LIVE indicator pulse

Nothing else carries this hue. Headers, cards, dividers stay neutral.

### Light theme (OKLCH)

```
--bg-canvas         oklch(98.5% 0.005 80)   /* warm off-white, slight peach */
--bg-surface        oklch(100%  0 0)
--bg-subtle         oklch(96%   0.006 80)
--bg-sunken         oklch(94%   0.008 80)   /* below-surface tint */
--bg-selected-hover oklch(92%   0.010 80)   /* hover on a selected list row */
--border-default    oklch(91%   0.008 80)
--border-strong     oklch(85%   0.012 80)
--text-primary      oklch(20%   0.01  295)  /* tinted toward brand */
--text-secondary    oklch(45%   0.01  295)
--text-muted        oklch(60%   0.008 295)

--accent            oklch(50%   0.18  295)  /* live signal / current action */
--accent-fg         oklch(99%   0.005 295)
--accent-soft       oklch(95%   0.03  295)  /* surface tint for accent-bearing region */
--accent-strong     oklch(40%   0.20  295)

--success           oklch(60%   0.15  150)
--warning           oklch(70%   0.16  75)
--danger            oklch(58%   0.20  25)
```

### Dark theme (OKLCH)

```
--bg-canvas         oklch(12% 0.01  295)
--bg-surface        oklch(16% 0.012 295)
--bg-subtle         oklch(20% 0.014 295)
--bg-sunken         oklch(10% 0.008 295)
--bg-selected-hover oklch(24% 0.016 295)    /* one tier LIGHTER than subtle in dark */
--border-default    oklch(25% 0.014 295)
--border-strong     oklch(35% 0.016 295)
--text-primary      oklch(94% 0.005 295)
--text-secondary    oklch(75% 0.01  295)
--text-muted        oklch(60% 0.012 295)

--accent            oklch(72% 0.16  295)    /* lighter in dark */
--accent-fg         oklch(15% 0.01  295)
--accent-soft       oklch(28% 0.04  295)
--accent-strong     oklch(80% 0.18  295)

--success           oklch(72% 0.16  150)
--warning           oklch(80% 0.16  75)
--danger            oklch(70% 0.20  25)
```

#### Accent budget

`--accent` and `--accent-soft` mark **current action or live signal only** —
never structural state. Structural-active (active nav item, mode toggle,
theme switcher, layout toggle) uses `--bg-subtle` + `text.primary` + weight
500. Accent-bearing surfaces:

- Play button + waveform cursor (current action)
- Currently-playing transcript segment (live signal)
- Preparing / ready / listening block on Realtime (live signal)
- Running chip in status palette (live signal, DESIGN-prescribed)
- Bulk action bar (current multi-select action)
- Search-result `<mark>` (current search)
- Focus ring (OS-level affordance)
- External links (web convention)

`statusPalette.ts` is the single source for job-status chip colors across
JobCard / HistoryPage / JobDetailPage. Never hard-code hex/rgba for status.

## Elevation

Three depths only — most surfaces stay flat.

```
--shadow-1   0 1px 0 rgb(0 0 0 / 4%)
--shadow-2   0 4px 12px rgb(0 0 0 / 6%), 0 1px 0 rgb(0 0 0 / 4%)
--shadow-3   0 12px 32px rgb(0 0 0 / 10%), 0 2px 6px rgb(0 0 0 / 6%)
```

- `--shadow-1`: row hover, ghost button hover.
- `--shadow-2`: popovers, dropdowns, the audio player frame.
- `--shadow-3`: modals (sparingly — prefer inline).

## Typography

Single sans (Inter, `ss01 cv11` features on for the rounded `a`/`g`). Mono
(JetBrains Mono) only for timecodes / model ids / NATS subjects.

```
font-family       Inter, "SF Pro Text", system-ui, sans-serif
font-features     "ss01", "cv11", "tnum" (only in .font-mono)
line-height-body  1.55
```

### Scale (1.25 step)

```
xs  11 / 16
sm  12 / 18
base 14 / 22       ← body default
md  16 / 24
lg  18 / 26
xl  22 / 30        ← page H1 (rare; most pages don't need one)
2xl 28 / 36
```

### Weight

Three weights. Anything else is forbidden.

- 400 — body
- 500 — table cells, captions that need to be findable
- 700 — section titles, primary buttons

No 600 (it sits between identities and reads muddy at small sizes).

## Spacing

8-step rhythm with a 4 inset for tight chips. Don't use everything — most
pages should live in 4 of these.

```
1   4px     2  8px     3  12px    4  16px
5   24px    6  32px    7  48px    8  64px
```

- Inline gap (chip ↔ text): `2`
- Section padding (card body): `4`
- Section gap (between distinct blocks): `6`
- Page top inset: `5` on narrow, `6` on wide

## Radius

Two values. Pills and circles are the only exceptions.

```
sm   6px    inputs, chips
md   10px   cards, panels
```

## Motion

- Standard duration: 140ms
- Curve: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint)
- Never animate `top`/`left`/`width`/`height` — transform/opacity only.
- `prefers-reduced-motion` ⇒ 0ms (already in `index.css`).

## Composition rules

These translate the impeccable shared design laws onto our pages:

### Cards are the exception, not the default

- Job list, transcript segments, settings rows → **rows with borders**, not
  cards. Card framing is reserved for: the audio player, transcript viewer,
  error/warning banners.
- Never nest cards. If a card needs sub-grouping, it's too big — split.
- **Settings + Dashboard sections** use the flat pattern: overline label
  (variant=overline, color=text.muted, letterSpacing=0.8) + content
  separated by `Stack spacing={5}`. No bordered container around the
  content. The vertical shoulder of space does the grouping work.

### One hue at a time

The accent appears in exactly **one place per viewport** if possible — the
button the user is most likely to press next. Status chips use their own
muted bg tints (`/ 12% alpha`), not the brand hue, so the eye lands on the
real action.

### No side-stripe borders

Top + full borders only. Side stripes on cards/alerts are banned.

### Status chips

Filled, 12% alpha bg, foreground = solid color of the same hue. Height 22 px,
weight 500, 11/16. Never use chips for navigation.

```
queued     → neutral muted
running    → accent (the only place chips use the brand hue)
succeeded  → success
failed     → danger
cancelled  → muted
```

### Tables vs grids

Use a **table** when the user wants to compare across rows (History dense
view). Use a **grid of cards** when each card's content varies enough that
column alignment doesn't help.

### Transcript segment row

Editable row, not a card. Hover lifts background to `--bg-subtle`. Active
(playing) segment uses `--accent-soft`. Edit mode shows a borderless
multiline input that inherits the row's typography.

### Multi-select list rows

Selected: `bgcolor: var(--bg-subtle)` (neutral — don't flood the table with
accent when "select all" is pressed). Hover on selected: `var(--bg-selected-hover)`
which is one tier deeper in light theme but one tier LIGHTER in dark theme,
keeping the "hover = lift" metaphor in both. Accent stays reserved for the
bulk-action bar above and the per-row status chip.

### Destructive actions

Never block on `window.confirm()` for bulk operations. The pattern is:
optimistic local removal + Snackbar with a 5-second undo button. The actual
delete fires on Snackbar dismissal. Single-item destructive (e.g. delete one
job) can still use `confirm` since the cost of an extra click is low and
single rows can be re-uploaded easily.

## Page recipes

### Navigation shell

The chrome around every page. Three parts:

- **Rail (Sidebar)** — desktop only. Collapsed to icons at `md` (64px), expanded
  with labels + group headings at `lg` (232px). Destinations are **grouped**, not
  a flat strip: ungrouped Home, then "create" (File / YouTube / Realtime), then
  "library" (History). Settings is pinned at the bottom. Collapsed rail shows a
  thin divider between groups instead of the overline label. Active item is
  structural (neutral `--bg-subtle` + 500 weight), never accent.
- **Mobile drawer** — below `md` the rail is hidden; a TopBar hamburger opens a
  temporary `Drawer` rendering the same grouped nav (always expanded). Closes on
  navigate.
- **TopBar** — left: hamburger (mobile) + **breadcrumb** (single page label on
  top-level routes, `History → Job detail` on the editor). Right: a
  **command launcher** styled like a search field (`⌘K` kbd hint) that opens the
  palette and works on touch, then the mode / language / hotkeys / theme
  controls. The launcher is the one place the header nods modern; keep it quiet
  (neutral border, muted text) so it doesn't compete with the page's accent.

`PrimaryNav` is the single source rendering the rail and the drawer body, so they
never drift. Breadcrumb labels reuse `nav.*` keys.

### Dashboard
- One column on small screens, 2-column grid on `md+`.
- Hardware card and Quick start are siblings; no hero.

### History
- Default view = dense table (B). Card grid (A) and timeline (C) remain
  prototypes until usage tells us otherwise.
- Status chip is the only colored thing per row.

### JobDetail
- Two-pane (B) is the default. Sticky left rail = meta + audio + export;
  right pane = transcript. The audio control stays reachable while scrolling
  6000-line transcripts.

### Realtime
- "preparing" state visible before the first chunk: button label changes,
  small helper sentence underneath, prob meter shows "·· loading".
- LIVE pulse is the only animation on screen during a session.

### Settings
- A **global dialog**, not a route — opened from the sidebar, the command
  palette, or a direct `/settings` link (which opens the dialog over the
  dashboard). Keeps the user's working context instead of swapping the whole
  view. This is the one justified exception to the "no modal as first thought"
  ban: settings is a self-contained, dismissable side-task.
- Inside: single column, max-width 560, sections separated by `6` gap. Each
  section has an `overline` label, never an `h6`.
- LoadedModelsCard sits between "Model" and "Translate" — that's where the
  user is reasoning about resources.

## Hard bans (carried from impeccable)

- No side-stripe borders.
- No gradient text.
- No glassmorphism.
- No hero-metric template.
- No identical card grids.
- No modal as first thought.
- No em dashes in code or copy. Use `·` or `→`.
