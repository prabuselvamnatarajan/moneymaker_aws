# Cobra Trades — Design System MASTER

> Global source of truth for every Cobra Trades screen (`BackTest/BackTestUI`).
> A page file in `design-system/cobra-trades/pages/<page>.md` overrides this file for that page only.
> Synced from `BackTest/BackTestUI` @ a6a72fa (src/index.css + Tailwind 4.1.14 defaults). Machine-readable copy: `tokens.json` beside this file.
> Token names = the Tailwind classes the code uses (`slate-900` ↔ `bg-slate-900`). Never introduce a raw hex in a component; never add a colour not listed here without the product owner's sign-off.

Cobra Trades is a dark-only, data-dense interface for an algorithmic trading and backtesting platform: the "algo audit engine". It feels like a terminal with manners. Near-black surfaces carry hairline borders. Small uppercase mono labels sit over bold sans figures. One blue accent marks what is active, green means profit, and rose means loss.

This system was taken from the `BackTest/BackTestUI` app in `prabuselvamnatarajan/moneymaker_aws` (React, Tailwind v4). Token names match the Tailwind classes the code uses, so `bg-slate-900` in the app is `slate-900` here.

## Content fundamentals

- **Voice: precise and operational.** Write like a trading desk log. Use short noun phrases for labels ("Realized P&L", "Max drawdown", "Open positions") and verbs for actions ("Run backtest", "Deploy", "Stop").
- **Labels are uppercase mono.** Field labels, column headers and card eyebrows use the `label` style: 10px JetBrains Mono, bold, `tracking-wider`, `slate-400`. Write them in sentence form in the source and let CSS uppercase them.
- **Numbers carry the meaning.** Show prices, quantities and P&L in mono (`label-caption`, or `font-mono` at a bigger size), right-aligned in tables, with a sign on P&L. Colour P&L by sign: `emerald-400` for a gain, `rose-400` for a loss, and never colour alone without the sign.
- **Status is a tag, not a sentence.** For a status, use a `label-micro` pill such as LIVE, PAUSED or FAILED, with a dot in the same hue.
- Product name: "Cobra Trades" in prose and "CobraTrades" in the sidebar wordmark. The tagline is "Algo audit engine".

## Visual foundations

### Surfaces

The app stacks four overridden slates. Watch the order: `slate-950` is *lighter* than `slate-900`.

| Layer | Token | Used for |
|---|---|---|
| Ground | `slate-900` `#0f1115` | Main dashboard background |
| Panel | `slate-950` `#15181e` | Sidebar, cards in the dashboard, inputs |
| Raised | `slate-800` `#1a1e25` | Headers, raised cards, secondary buttons |
| Line | `slate-800` / `slate-700` | 1px borders; `slate-700` for hover, selected and stronger borders |

**Borders, not shadows.** Every card, input and table row edge is a 1px `slate-800` border. Shadows appear only on modals (`shadow-2xl`) and primary buttons (`shadow-lg`).

### Colour roles

- **Brand blue.** The code calls this ramp `indigo`, but it is overridden to blue. Use `indigo-400` for active and accent text, `indigo-600` for filled primary buttons (hover `indigo-500`, pressed `indigo-700`), and `indigo-500` for focus borders. `indigo-900` and `indigo-950` are translucent brand washes for selected rows and badges.
- **Signals.** Profit is `emerald-400` (text) or `emerald-500` (fills). Loss and errors are `rose-400` (text), `rose-500` (fills) or `rose-600` (destructive buttons). Warnings and pending states are `amber-400` or `amber-500`. A signal badge is the hue at 10% on the ground (`bg-emerald-500/10`) with a 20% border and the -400 text.
- **Categorical extras.** `purple-400` and `cyan-400` are sparing second and third series colours.
- **Text ramp.** Primary text is `slate-100`, body text `slate-200` and `slate-300`, muted text `slate-400`, tertiary `slate-500`, and disabled or placeholder text `slate-600`.

### Contrast notes (measured on `slate-900` and `slate-950`)

- `slate-100` to `slate-400`, `indigo-300` and `indigo-400`, and every -400 signal hue all pass 4.5:1.
- **`slate-500` gives 3.7–4.0:1.** It is used 283 times for 9–12px text, so it fails at those sizes. Prefer `slate-400` for anything a person must read.
- **`slate-600` gives about 2.4:1.** Use it only for disabled text and placeholders.
- **White on `indigo-500` (button hover) gives 3.7:1.** White on `indigo-600` passes at 5.2:1.

### Type

- **Inter** (`sans`) carries headings and UI copy. **JetBrains Mono** (`mono`) carries labels, figures and anything tabular, and it is used more than the sans. Both load from Google Fonts, Inter at weights 300–900 and JetBrains Mono at 300–800.
- The UI is small. `body-xs` (12px) is the default control and table size, and the 10px `label` is the signature style. Headings are bold (`font-bold`, sometimes `font-black`) with `tracking-tight`.

### Space and shape

- Spacing uses a 4px base step. Stacks use `space-1`, controls `space-2` and `space-2.5`, cards `space-4`, and panels and modals `space-6`.
- For radius, controls use `radius-md` (6px), cards and modals `radius-xl` (12px), pills and the logo tile `radius-sm` (4px), and status dots `radius-full`.

### Motion

Motion is quick and functional. Colours change with `transition-colors`. Toasts slide in from the right over 0.25s with `cubic-bezier(0.16, 1, 0.3, 1)`, and the LIVE dot pulses.

## Patterns, as the code writes them

- **Primary button:** `px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md text-xs`
- **Input:** `w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:border-indigo-500` (add `font-mono` for numeric fields)
- **Card:** `bg-slate-950 p-4 rounded-xl border border-slate-800`
- **Modal:** `max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl`
- **Label:** `text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold`
- **Status pill:** `text-[9px] bg-emerald-500/10 text-emerald-400 font-mono px-1.5 py-0.5 rounded border border-emerald-500/20` plus a `w-1.5 h-1.5 rounded-full` dot
- **Table row:** `hover:bg-indigo-600/5 transition-colors`, with figures right-aligned in mono

## Iconography and logo

- **Icons:** [lucide-react](https://lucide.dev) (0.546), stroke icons, 14–16px in controls, coloured with the surrounding text token. None are bundled here, so take them from the library.
- **Logo:** the code has no logo file. The mark is a 32px `indigo-500` square at `radius-sm` with a bold white "C", next to the wordmark "CobraTrades" (14px Inter bold, uppercase, `tracking-tight`, white) and the tagline "ALGO AUDIT ENGINE" (10px mono, `slate-500`). Rebuild it in type until a drawn mark exists.

## Not synced

- **Undefined classes:** the code uses `slate-850`, `slate-955`, `slate-350`, `slate-650`, `rose-350`, `rose-450`, `rose-455` and `rose-955` about 110 times. Tailwind v4 defines none of them, so those classes produce no CSS. They are left out here. Map each one to a real step in the code.
- **No font files:** both faces are hosted on Google Fonts.
- **No assets:** there is no logo file, and the icons come from lucide-react.
- **No components:** the app has 23 view components (Sidebar, DashboardView, Toast, LoginView and more) but no exported component library, so no live components were built. Button, Input, Card, Badge and Table could be hand-written from the patterns above.
- **The older `client/` app** (Bootstrap 5, light theme) was not included.

## Token reference

### Colour (dark theme only)

| Token | Value | Usage |
|---|---|---|
| `slate-900` | `#0f1115` | Main dashboard background, the app's ground. Overridden in the source theme; note it is DARKER than slate-950. |
| `slate-950` | `#15181e` | Sidebar, cards inside the dashboard (bg-slate-950 p-4 rounded-xl), and form inputs. |
| `slate-800` | `#1a1e25` | Headers, raised cards and secondary buttons; also THE hairline border colour (border-slate-800 is the most used class in the app). |
| `slate-700` | `#232a35` | Stronger borders, hover and selected rows, scrollbar thumbs. |
| `white` | `#ffffff` | Text on filled brand buttons and the logo tile; headline numbers. |
| `slate-100` | `oklch(96.8% 0.007 247.896)` | Primary text, input values. 17:1 on slate-900. |
| `slate-200` | `oklch(92.9% 0.013 255.508)` | Body text in tables and cards. |
| `slate-300` | `oklch(86.9% 0.022 252.894)` | Secondary body text, descriptions. |
| `slate-400` | `oklch(70.4% 0.04 256.788)` | Muted text and the standard mono uppercase label. 7.2:1 on slate-900. |
| `slate-500` | `oklch(55.4% 0.046 257.417)` | Tertiary text, timestamps, sub-labels. FLAG: 3.7–4.0:1 on the dark surfaces, below 4.5:1 for the 9–12px text it is used at; prefer slate-400 for anything a person must read. |
| `slate-600` | `oklch(44.6% 0.043 257.281)` | Placeholders and disabled text. FLAG: ~2.4:1, fails as text; disabled states only. |
| `indigo-300` | `#93c5fd` | Brand text on brand-tinted fills; hover for indigo-400 links. |
| `indigo-400` | `#60a5fa` | Brand accent text: active nav, links, highlighted labels, figures. Named indigo in code but overridden to blue. 7.4:1 on slate-900. |
| `indigo-500` | `#3b82f6` | Logo tile, focus border on inputs (focus:border-indigo-500), active tab underline, filled-button hover. FLAG: white text on it is 3.7:1, below 4.5:1 for the 12px button label. |
| `indigo-600` | `#2563eb` | Primary filled button (bg-indigo-600 text-white, 5.2:1). |
| `indigo-700` | `#1d4ed8` | Pressed primary button. |
| `indigo-800` | `#1e40af` | Deep brand, rarely used. |
| `indigo-900` | `rgba(37, 99, 235, 0.15)` | Brand tint behind badges and selected items. |
| `indigo-950` | `rgba(37, 99, 235, 0.08)` | Faint brand wash, e.g. the BackTest tag on the login screen. |
| `emerald-400` | `oklch(76.5% 0.177 163.223)` | Profit, positive P&L, LIVE / success status text. Tailwind default. |
| `emerald-500` | `oklch(69.6% 0.17 162.48)` | Profit fills and status dots; at /10 opacity a success badge ground. |
| `rose-300` | `oklch(81% 0.117 11.638)` | Loss or error text on rose-tinted grounds. |
| `rose-400` | `oklch(71.2% 0.194 13.428)` | Loss, negative P&L, error text. Tailwind default. |
| `rose-500` | `oklch(64.5% 0.246 16.439)` | Danger fills, error dots; at /10 opacity an error badge ground. |
| `rose-600` | `oklch(58.6% 0.253 17.585)` | Destructive filled button. |
| `amber-400` | `oklch(82.8% 0.189 84.429)` | Warning and pending text. |
| `amber-500` | `oklch(76.9% 0.188 70.08)` | Warning fills; at /10 opacity a warning badge ground. |
| `purple-400` | `oklch(71.4% 0.203 305.504)` | Occasional categorical accent (strategy or signal type). |
| `cyan-400` | `oklch(78.9% 0.154 211.53)` | Occasional categorical accent (secondary series in charts). |

### Type styles

Families: `sans` = "Inter", ui-sans-serif, system-ui, sans-serif; `mono` = "JetBrains Mono", ui-monospace, SFMono-Regular, monospace.

| Style | Family | Size / line | Weight | Tracking | Usage |
|---|---|---|---|---|---|
| `heading-3xl` | sans | 30px / 36px | 700 | -0.025em | Rare page hero (login). |
| `heading-2xl` | sans | 24px / 32px | 700 | -0.025em | Headline figures and page titles. |
| `heading-xl` | sans | 20px / 28px | 700 | – | View titles and KPI values (text-xl font-bold). |
| `heading-lg` | sans | 18px / 28px | 600 | – | Modal and section titles. |
| `body-base` | sans | 16px / 24px | 400 | – | Rare; long-form copy. |
| `body-sm` | sans | 14px / 20px | 500 | – | Nav items, prominent table cells. |
| `body-xs` | sans | 12px / 16px | 400 | – | THE default UI size: inputs, buttons, table rows, card copy (454 uses). |
| `label-caption` | mono | 11px / 16px | 500 | – | Mono figures in dense tables: prices, quantities, timestamps. |
| `label` | mono | 10px / 15px | 700 | 0.05em | The signature label: uppercase, tracking-wider, bold, slate-400 (or indigo-400 when active). Field labels, column headers, card eyebrows. |
| `label-micro` | mono | 9px / 14px | 600 | 0.05em | Status pills (LIVE), sub-captions under buttons. Smallest size; keep to short tags. |

### Spacing (4px base)

| Token | Value | Usage |
|---|---|---|
| `space-0.5` | `2px` | Badge vertical padding (py-0.5). |
| `space-1` | `4px` | Tight gaps, stacked label-to-value (space-y-1, the most used step). Base unit: Tailwind --spacing 0.25rem. |
| `space-1.5` | `6px` | Icon-to-text gap inside buttons and badges (gap-1.5). |
| `space-2` | `8px` | Button vertical padding, input padding, default gap. |
| `space-2.5` | `10px` | Comfortable input padding (p-2.5). |
| `space-3` | `12px` | Table cell padding, card-internal gaps. |
| `space-4` | `16px` | Card padding (p-4), button horizontal padding, stack gap between groups. |
| `space-6` | `24px` | Panel and modal padding (p-6). |

### Radius

| Token | Value | Usage |
|---|---|---|
| `radius-xs` | `2px` | Tiny tags. |
| `radius-sm` | `4px` | Status pills, the C logo tile (Tailwind 'rounded' and 'rounded-sm' are both 4px). |
| `radius-md` | `6px` | Buttons and inputs: the default control radius. |
| `radius-lg` | `8px` | Icon tiles, toasts, nested panels. |
| `radius-xl` | `12px` | Cards and modals. |
| `radius-2xl` | `16px` | Large hero panels (login). |
| `radius-full` | `9999px` | Status dots and avatar circles. |

### Shadow

| Token | Value | Usage |
|---|---|---|
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Subtle lift on inputs and chips. |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | Primary buttons (paired with a faint indigo-600/10 glow in code). |
| `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | Modals and floating panels. |
