---
name: ncgg.dev
description: A portfolio that is a live ASCII fluid; monochrome monospace text and media float on a gray glyph field over pure black.
colors:
  void-black: "#000000"
  bone-white: "#ededed"
  ash-gray: "#a3a3a3"
  smoke-gray: "#8a8a8a"
  hairline-dim: "#1f1f1f"
  hairline: "#363636"
typography:
  display:
    fontFamily: "Martian Mono, Azeret Mono, ui-monospace, monospace"
    fontSize: "clamp(2.4rem, 1.2rem + 5vw, 5.75rem)"
    fontWeight: 300
    lineHeight: 0.95
    letterSpacing: "-0.04em"
    fontVariation: "\"wdth\" 87.5"
  headline:
    fontFamily: "Martian Mono, Azeret Mono, ui-monospace, monospace"
    fontSize: "clamp(1.35rem, 0.9rem + 2vw, 2.6rem)"
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: "-0.03em"
    fontVariation: "\"wdth\" 87.5"
  title:
    fontFamily: "Martian Mono, Azeret Mono, ui-monospace, monospace"
    fontSize: "clamp(1.05rem, 0.9rem + 0.6vw, 1.3rem)"
    fontWeight: 400
    letterSpacing: "-0.02em"
    fontVariation: "\"wdth\" 87.5"
  statement:
    fontFamily: "Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(1.25rem, 0.95rem + 1.25vw, 1.9rem)"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.02em"
rounded:
  none: "0px"
  focus: "2px"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  column-gap: "clamp(12px, 2vw, 28px)"
  section-y: "clamp(96px, 16vh, 200px)"
  bar-height: "64px"
  bar-height-compact: "56px"
  row-y: "clamp(18px, 2.4vw, 30px)"
components:
  action:
    textColor: "{colors.bone-white}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "44px"
  action-hover:
    backgroundColor: "{colors.bone-white}"
    textColor: "{colors.void-black}"
  motion-toggle:
    textColor: "{colors.ash-gray}"
    typography: "{typography.label}"
    padding: "0 2px"
    height: "40px"
  motion-toggle-hover:
    textColor: "{colors.bone-white}"
  nav-link:
    textColor: "{colors.ash-gray}"
    typography: "{typography.label}"
    padding: "8px 0"
  nav-link-active:
    textColor: "{colors.bone-white}"
  tag:
    textColor: "{colors.ash-gray}"
    typography: "{typography.label}"
  media-frame:
    backgroundColor: "rgba(0,0,0,0.86)"
    rounded: "{rounded.none}"
---

# Design System: ncgg.dev

## Overview

**Creative North Star: "The Terminal in the Current"**

The page is a running simulation before it is a document. A stable-fluids solver fills the viewport with gray ASCII glyphs on pure black, and every other element (the wordmark, section headings, text columns, project media) either is made of glyphs or floats on top of that field. The visitor's cursor, scroll and clicks push the fluid; the interface answers movement rather than waiting for it.

Everything is monospace and monochrome. Hierarchy comes from scale, weight and the variable width axis of one display face, and from three steps of gray, never from hue. Structure is drawn with 1px hairlines; depth comes from progressive backdrop blur and soft black veils that quiet the field behind text, not from shadows or raised surfaces. Interactive controls borrow terminal syntax: brackets around actions, angle brackets around annotations.

Density is low and placement is deliberate: a 12-column grid used asymmetrically, display headings set left, right or full width per section, work media staggered across columns at varied aspect ratios.

**Key Characteristics:**
- Pure black ground with a live gray ASCII glyph field behind all content.
- Monospace only: Martian Mono for display, Azeret Mono for everything else.
- No hue anywhere; three text grays and two hairline grays.
- Depth by progressive blur and black veils, never by shadow or card.
- Terminal syntax as ornament: `[ action ]`, `<annotation>`, ASCII markers.
- Motion that answers the visitor: weight follows the cursor, text scrambles on hover, content unblurs on entry.

## Colors

A strictly achromatic palette: one black, one near-white, two text grays, two hairline grays.

### Primary
- **Bone White** (bone-white): primary text, display headings, the active nav state, focus outline, and the inverted fill of an action on hover. It is the only "accent"; emphasis means moving text from gray to bone white.

### Neutral
- **Void Black** (void-black): the page ground, the field's background, the text of inverted controls, and the base of every veil and blur band. Never lifted to a dark gray surface.
- **Ash Gray** (ash-gray): secondary text: nav links at rest, discipline descriptions, tags, ledes, bracket characters.
- **Smoke Gray** (smoke-gray): tertiary text: metadata, fact labels, readouts, footer, the angle brackets of tags.
- **Hairline** (hairline): 1px rules between list rows, above facts, and around media frames.
- **Hairline Dim** (hairline-dim): the footer's top rule, the faintest division on the page.

The glyph field is rendered in grays from 16% to 86% luminance in 14 steps (`rgb(41,41,41)` to `rgb(219,219,219)`); generative work media use 22% to 92%, dimmed to 72% at rest and brought to full on hover.

### Light theme
Dark is the default and the identity; light is an opt-in inversion via the `[ light ]` toggle (stored as `ncgg:theme`, applied before first paint on `html[data-theme="light"]`). Every colour is a token in `:root`, so the light theme only redefines tokens: ground `#f2f2f2`, primary text `#121212`, secondary `#4a4a4a`, tertiary `#616161`, hairlines `#dddddd` / `#bcbcbc`. The glyph field and the work media do not invert pixels; they mix from the ground toward the ink (`mix(bg, ink, strength)` in the shader), so the same strength ramp produces dark glyphs on light ground. Veils, blur bands and text halos use `rgb(var(--bg-rgb) / a)`, never a literal black. The switch is a circular view-transition reveal from the toggle (skipped under reduced motion).

### Named Rules
**The No-Hue Rule.** Nothing on the page carries chroma. State, emphasis and selection are expressed by moving between the grays and bone white, or by inverting to bone white on black.

**The Brighten-On-Attention Rule.** Interactive and hovered elements step up one gray (smoke to ash, ash to bone white); nothing ever dims to signal interaction.

## Typography

**Display Font:** Martian Mono (variable `wdth` 75 to 112.5, `wght` 100 to 800), falling back to Azeret Mono, then system monospace.
**Body Font:** Azeret Mono (`wght` 300 to 700), falling back to ui-monospace, SFMono-Regular, Menlo, Consolas.

**Character:** Two monospaces with different jobs. Martian Mono, condensed to `wdth` 87.5 and set light with tight negative tracking, gives large headings a drawn, technical presence; Azeret Mono carries reading text and every small label at an even, readable rhythm.

### Hierarchy
- **Display** (300, `wdth` 87.5, fluid up to 5.75rem, 0.95): section headings (about, practice, work, languages, contact). Also the scale used for the language list (up to 5.5rem) and the contact address (up to 5rem), both at 300 and -0.04em.
- **Headline** (300, `wdth` 87.5, up to 2.6rem, 1.05): discipline names in the practice list.
- **Title** (400, `wdth` 87.5, up to 1.3rem): work piece titles.
- **Statement** (Azeret 400, up to 1.9rem, 1.42, max 38ch): the about statement; the hero descriptor uses the title-scale size (up to 1.3rem, 1.45, max 34ch).
- **Body** (Azeret 400, 0.9375rem, 1.6, max 52ch): descriptions and ledes.
- **Label** (Azeret 400, 0.75rem, +0.02em, lowercase): nav, controls, tags, metadata, readouts, footer.

The hero wordmark "ncgg" is not text in the DOM flow: it is rendered as a glyph mask inside the fluid using Martian Mono at weight 800 (the accessible heading is visually hidden).

### Named Rules
**The Lowercase Interface Rule.** Nav, controls, headings and labels are lowercase. No uppercase-tracked labels.

**The Weight-Follows-Cursor Rule.** Display headings, language names and the contact address are split per character; each character's weight and width track cursor proximity (resting at 300 and `wdth` 87.5). Discipline names jump from 300 to 700 on row hover.

## Layout

A 12-column grid (column gap `clamp(12px, 2vw, 28px)`) inside a fluid gutter (`clamp(16px, 4vw, 56px)`), with sections padded `clamp(96px, 16vh, 200px)` vertically. Placement is asymmetric per section: about sets the heading in columns 1 to 4 and the body in 6 to 12; practice right-aligns its heading full width and indents the list from column 2; languages pins a sticky heading in columns 1 to 5 beside the list; contact runs the heading full width and indents the body from column 3.

The hero is a full viewport (`100svh`, min 520px) with content pinned to corners: wordmark top-left, nav top-right, descriptor bottom-left, live readout bottom-right, vertical side-label at the right edge, scroll cue at bottom centre.

Work pieces stagger across the grid in pairs (7 + 4, 5 + 5, 7 + 4 columns) with offset top margins and distinct aspect ratios (16:10, 3:4, 1:1, 4:3, 16:9, 4:5); row gap `clamp(72px, 10vw, 140px)`.

Breakpoints: at 1024px, split layouts collapse to full width and the sticky heading becomes static. At 720px the bar shrinks to 56px, the side-label and motion state word hide, the readout moves bottom-left, discipline descriptions wrap under their names, and work pieces go full width with two indented to column 3.

## Elevation & Depth

Flat, with depth carried by blur. Nothing is raised: there are no box shadows on surfaces and no cards. Instead:

- **Progressive blur bands** fix to the viewport top (132px) and bottom (84px): five stacked layers at 1, 2, 4, 8 and 14px backdrop blur, each masked to a successively narrower slice, plus a black gradient. Content dissolves into the edges rather than being cut off.
- **Veils** sit behind text columns: `rgba(0,0,0,0.62)` with 5px backdrop blur under a radial mask that fades at the edges, so text reads cleanly while the field stays visible around it.
- **Row and caption veils**: list rows carry `rgba(0,0,0,0.72)` with 6px blur at 60% opacity, rising to full on hover; work captions carry a vertically feathered `rgba(0,0,0,0.7)` veil.
- **Media blur**: the lower 38% of each work frame is blurred 3px and clears on hover.
- **Black halos**: text floating directly on the field (hero descriptor, readout, language names) uses `text-shadow` glows of pure black (6 to 24px, no offset) for legibility.

### Named Rules
**The Blur-Not-Shadow Rule.** Separation from the field is made with backdrop blur and black veils. Shadows appear only as zero-offset black halos behind text, never as offset or tinted drop shadows.

**The Unblur-On-Entry Rule.** Revealed content enters from 8% opacity, 14px blur and 18px down, settling over 1.1 to 1.3s on the house easing; only with JS and only when motion is allowed.

## Shapes

Square and linear. Every frame, rule and control has a 0px radius; the only curves are the 2px rounding on the focus outline and the 6px circular motion indicator. Form is drawn with 1px hairlines, not filled shapes. Media frames mark their top-left corner with a small "+" registration cross. Underlines are drawn as 1px lines that grow from the left on hover.

## Components

### Buttons (bracketed actions)
- **Character:** terminal commands. Text wrapped in ash-gray `[` and `]` drawn by pseudo-elements.
- **Shape:** square (0px), 44px minimum height, 10px side padding, label type.
- **Default:** bone-white text on nothing; an optional 14px stroked line icon (1.4 stroke) before the label.
- **Hover:** inverts to a bone-white fill with black text and black brackets (0.3s).
- **Done state:** after copying, brackets brighten to bone white and the label confirms.

### Motion toggle
- **Character:** a bracketed status control in the bar: `[ ● motion on ]`.
- **Style:** ash-gray label type, 40px tall; a 6px bone-white dot that pulses a soft ring while motion is on, and becomes a hollow smoke-gray ring when off. Brightens to bone white on hover. The state word hides below 720px.

### Tags (annotations)
- **Style:** label type in ash gray, wrapped in smoke-gray `<` and `>`. Used to mark placeholder content inline after titles and actions. Darkens to `#3a3a3a` inside an inverted action.

### Navigation
- **Style:** the fixed bar holds the wordmark (bone white, 500) left and lowercase links right, all in label type with 0.02em tracking.
- **States:** links rest in ash gray; hover and the current section turn bone white and draw a 1px underline that scales in from the left (0.5s). Link text scrambles through ASCII characters (`.:-=+*#%@/\|~<>[]{}`) for 420ms on hover.

### Rule list (practice and languages)
- **Style:** full-width rows separated by 1px hairlines, each on a blur veil. Practice rows are name, description and an ASCII marker (`[]`, `{}`, `>_`, `/\`, `::`, `@@`) in smoke gray; language rows are display-scale names with an optional live block caret.
- **Hover:** the veil goes to full opacity, the name bolds (300 to 700), tightens and shifts 10px right, and description and marker brighten to bone white; the marker scrambles.

### Media frame (work piece)
- **Style:** 1px hairline border, `rgba(0,0,0,0.86)` fill, square corners, "+" corner mark, fixed aspect ratio per slot. Content is a generative ASCII canvas, or an image or video rendered grayscale (contrast 1.05, brightness 0.85).
- **Hover:** border lifts to `#6a6a6a`, the bottom blur clears, imagery brightens to full and scales 1.02.
- **Caption:** title in display face with an inline tag, smoke-gray metadata, ash-gray description, on a feathered veil.

### Facts list
- **Style:** an auto-fitting grid (min 170px) of label-size pairs, each topped by a 1px hairline: smoke-gray term over bone-white value.

### ASCII field (signature)
The full-viewport WebGL canvas behind everything: a fluid solver drawn as glyphs from a density ramp (`. · : - ~ = + * x % # @`) and directional strokes (`- \ | /`). Cursor movement, scroll and clicks inject velocity and density; the hero wordmark is a mask the flow smears and that springs back. It fades in over 1.6s once fonts load, and stops animating when motion is toggled off or reduced motion is set.

### Work panels
At the user's request each work entry is a raised panel, the one sanctioned exception to "no cards": `rgb(var(--panel-rgb) / 0.9)` with a 12px backdrop blur, a 1px `--panel-line` border, `+` registration ticks on two corners, and a soft offset shadow (`--panel-shadow`, stronger on hover, plus a 3px lift). Light theme panels are white on the `#f2f2f2` ground so they read as distinct sheets. Media sits inside on `--media-bg` with a hairline border. Most work media are ASCII; the FTC match is the exception, a flat-shaded isometric vector scene (js/ftc.js) drawn from the same bg→ink mix so it stays monochrome in both themes.

### Photo drawer
Real photography lives behind a drawer, not on the page: a native `<dialog class="drawer">` slides in from the right (full width on phones) over a blurred `--bg` backdrop, opened by a bracketed `[ open photos · n ]` action in a work caption. Inside, a two-column grid of thumbnails (4:3 and 3:4 crops) sits in grayscale and returns to colour on hover or focus, each with a `> caption`. Selecting one opens an in-drawer viewer with `[ prev ] [ next ] [ grid ]`; arrow keys page, Esc steps back from viewer to grid to page, and focus returns to the opener. Colour is allowed here only because it is the work's own content.

## Do's and Don'ts

### Do:
- **Do** keep the ground pure black (`#000`) and let the glyph field show between and around content.
- **Do** express hierarchy with the three text grays, size, and Martian Mono's weight and width axes.
- **Do** place a blur veil behind any text column that sits over the field.
- **Do** frame actions as `[ label ]` and annotations as `<label>`, in lowercase label type.
- **Do** draw structure with 1px hairlines (`#363636`) and keep every corner square.
- **Do** ease every transition on `cubic-bezier(0.16, 1, 0.3, 1)`, and keep all continuous motion pausable and off under reduced motion.
- **Do** render imagery grayscale.

### Don't:
- **Don't** introduce any hue, including for links, focus, success or error states.
- **Don't** use a non-monospace typeface anywhere.
- **Don't** lift content onto filled cards, dark-gray panels, or rounded containers.
- **Don't** use offset, tinted or elevation drop shadows; only zero-offset black text halos.
- **Don't** set labels in uppercase with wide tracking.
- **Don't** hard-cut content at the viewport edges; let the progressive blur bands dissolve it.
