# PATS Brand Guidelines

Reference for building any PATS module, screen, or career site. Assets live in this folder; tokens are in `tokens.css`.

## Logo

| File | Use on |
|---|---|
| `logos/purpose-wordmark-black.png` | Ivory, white, or other light backgrounds |
| `logos/purpose-wordmark-white.png` | Black or other dark backgrounds |

Both are 2000×1044 PNGs with transparent backgrounds. Do not recolour, stretch, or add effects to the wordmark.

## Colour palette

Source: `reference/brand-palette.png`.

| Token | Hex | Role |
|---|---|---|
| Ivory | `#F4F3EA` | **Primary.** Main background colour. Adds warmth and openness to editorial layouts. |
| Warm Neutral | `#A39E9D` | **Secondary.** Mid-tone for understated layouts or layered depth. |
| Black | `#000000` | **Execution.** Main anchor colour. Represents precision; the primary colour for text and key UI across all communications. |

Hex values are sampled from the palette reference image. Replace them if the official brand book gives different values.

Usage notes:
- Default surface is Ivory with Black text and marks.
- Use Warm Neutral for secondary surfaces, dividers, and muted elements. Warm Neutral on Ivory is too low-contrast for body text, so don't use it for text.
- Black surfaces take the white wordmark and Ivory text.

## Typography

| Typeface | Role | Files |
|---|---|---|
| **Season Mix** | Primary typeface. Headings and subheadings. | `fonts/season-mix/SeasonMix-Regular.{otf,ttf}`, `SeasonMix-Medium.{otf,ttf}` |
| **Inter** | Secondary typeface. Body copy, UI labels, tables, and forms. | `fonts/inter/Inter.ttc` |

The palette reference shows this pairing: the "Brand Palette" title is set in Season Mix and the body copy is in Inter.

Web notes:
- Browsers can't load `.ttc` collections. For the web app, use Inter as `.woff2` (from the official Inter release or Google Fonts). Keep the `.ttc` for desktop and design use.
- Load Season Mix from the `.ttf`/`.otf` files, or convert them to `.woff2` for production. Season Mix is a licensed font, so check the licence before serving it from a public career site.
