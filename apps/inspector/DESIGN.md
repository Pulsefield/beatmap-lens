# Beatmap Lens Inspector design language

## 1. Visual theme and atmosphere

The Inspector is a precision paper lab: a high-key workspace with quiet white surfaces,
graphite typography, and a small cobalt signal color. The application chrome stays restrained so
the dark beatmap render can become the single rich visual anchor when it is present.

The interface is precise, calm, and kinetic. It should feel like a focused inspection instrument,
not a generic analytics dashboard or a collection of cards.

## 2. Color palette and roles

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `oklch(96% 0.008 255)` | Cool paper surrounding the work surface |
| Surface | `oklch(100% 0 0)` | Primary workspace |
| Surface quiet | `oklch(97.5% 0.006 255)` | Editor and inset controls |
| Ink | `oklch(21% 0.018 255)` | Primary text and primary action |
| Ink secondary | `oklch(43% 0.018 255)` | Supporting labels |
| Ink muted | `oklch(59% 0.014 255)` | Tertiary metadata |
| Signal | `oklch(57% 0.21 258)` | Focus, selected states, and active status |
| Success | `oklch(59% 0.15 153)` | Ready pipeline state |
| Warning | `oklch(69% 0.16 76)` | Diagnostics present |
| Danger | `oklch(60% 0.2 27)` | Pipeline failure |

Neutrals carry a faint cool tint. Signal color is used as status ink, never as a decorative wash.

## 3. Typography rules

- Interface text uses the native sans stack for fast, familiar controls and compact reading.
- `Azeret Mono Variable` is reserved for the product mark, indexes, source, statuses, and numbers.
- Display title: 30px, weight 650, line-height 1.08, letter-spacing `-0.022em`.
- Section title: 13px, weight 650, line-height 1.25.
- Body: 13px to 14px, weight 450 to 550, line-height 1.5.
- Data: 11px to 13px, weight 520 to 650, tabular numerals.
- Headings use balanced wrapping. Descriptions use pretty wrapping. Code keeps natural wrapping.

## 4. Component styling

- Buttons use a fixed 10px radius and a 40px minimum hit area. Primary buttons are graphite,
  quiet buttons are white with a layered hairline shadow. Hover changes color and shadow; press
  scales to `0.96` with an interruptible transition.
- The workspace is one continuous surface. Internal regions use structural 1px dividers instead of
  becoming separate cards.
- Textareas use a quiet inset surface and 14px radius. The surrounding 8px gutter produces a 22px
  concentric outer relationship.
- Statuses pair a small color dot with text. Color is never the only indicator.
- The beatmap preview is an inset rich surface with an 8px gutter, 22px outer radius, and 14px inner
  radius.

## 5. Layout principles

- Desktop: source column, flexible preview, optional details column.
- The preview owns the most width and remains the main visual anchor.
- Metadata appears in line-based rails with aligned labels and tabular values.
- Spacing scale: 4, 8, 12, 16, 24, 32px. Dense rows use vertical space sparingly and columns get
  the larger gaps.

## 6. Depth and elevation

- Canvas to workspace is a 4% lightness step. The full-width workspace stays flat and continuous.
- Elevated controls use three layers: a translucent 1px ring, a short contact shadow, and a soft
  ambient shadow.
- Borders are reserved for dividers and table-like rows. There are no decorative card borders.
- The rendered SVG gets a 10% inset outline so its dark edge remains crisp against the white shell.

## 7. Do and do not

- Do keep the application shell white and the beatmap itself visually rich.
- Do use monospaced type only for technical identity and changing data.
- Do keep state transitions short, interruptible, and transform or opacity based.
- Do preserve the editor, keyboard shortcut, error state, facts, and full pipeline detail.
- Do align numeric values on a stable right edge.
- Do not add gradients, glass surfaces, thick accent rails, or a grid of equal cards.
- Do not use accent color for large backgrounds.
- Do not hide ordinary overflow in a modal.
- Do not animate layout properties or use `transition: all`.

## 8. Responsive behavior

- Above 920px, source, preview, and optional details are visible as columns.
- At 920px and below, a compact three-view switch shows Source, Preview, or Details in the same
  workspace position so the preview is never pushed below a long editor.
- At 375px, controls retain 40px hit areas, the chart title remains readable, and metadata becomes a
  two-column rail.
- Safe-area insets apply to the outer app shell.

## 9. Agent prompt guide

- "Add an Inspector control on white `oklch(100% 0 0)`, 40px tall, 10px radius, 13px weight 600,
  graphite `oklch(21% 0.018 255)`, with an interruptible `scale(.96)` press state."
- "Add an inset technical panel with an 8px quiet gutter `oklch(97.5% 0.006 255)`, 22px outer
  radius, 14px inner radius, and no decorative border."
- "Add a metric row with a left-aligned native-sans label at 11px and a right-aligned Azeret Mono
  value at 12px using tabular numerals and a 1px structural divider."
- "Add a status using a semantic color dot plus text, with ready `oklch(59% 0.15 153)`, warning
  `oklch(69% 0.16 76)`, and danger `oklch(60% 0.2 27)`."
