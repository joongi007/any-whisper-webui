# PRODUCT.md

> Impeccable context document. Frames the register and design intent for every
> page in `ui/`. Used by the `impeccable` skill's `load-context.mjs`.

## Register

**product** — the UI serves the work, not the other way around. No marketing
gloss. Density-aware. No hero gradients, no sticky CTA bars, no "trusted by"
sections. The user came here with audio they need transcribed; the UI's job
is to disappear after the second click.

## Users

A single developer / power user, local-first, technical literacy high enough
to know what `compute_type=float16` means but who still wants the common path
to be one click. They run on:

- A workstation with a discrete NVIDIA GPU (RTX 30/40-series; 8–24 GB VRAM)
- Linux or WSL2 (current host is WSL2 + Win11 host)
- Chrome / Edge primary, occasionally Firefox

They use this for:

- Transcribing meeting recordings (60–180 min files)
- Live captioning of tab audio (YouTube lectures, Zoom calls they're attending)
- Subtitle cleanup before sending to others — edit-in-place is mandatory

They don't use this for:
- Mass batch processing
- Multi-user / sharing
- Mobile (responsive matters but the canonical surface is a wide display)

## Product purpose

Take whatever audio source the user can throw at a desktop browser
(file / YouTube URL / mic / tab) and return clean editable subtitles. The
ranking of values, when they collide:

1. **Visible state** — never make the user guess whether the model is loaded,
   whether VAD is hearing them, or whether their edit was saved.
2. **Editability** — a transcript that can be fixed inline and re-exported
   is worth more than a slightly more accurate one that's read-only.
3. **Latency feel** — first chunk to first partial under 1.5 s for realtime;
   any heavier work is a *job* with a progress bar.
4. **Power-user surface** — every knob is reachable in Advanced mode; Simple
   hides everything that has a reasonable default.

## Tone

- **Korean primary**, English secondary. The user thinks in Korean for product
  copy, English for technical labels (subjects, backend names, compute_type).
- Short. No marketing voice. No exclamation points. No "Awesome!" copy.
- Numbers over adjectives. "1.6 GB · ~10s 로드" beats "fast and lightweight".
- Errors say what's wrong AND what to do, in one sentence.

## Anti-references

What this UI is **not** trying to look like:

- ❌ **OpenAI ChatGPT** — gradient halos, mauve illustrations, "Try X" cards.
- ❌ **Linear** — over-polished marketing density, oversized hero glyphs.
- ❌ **Notion** — soft cards everywhere, no hierarchy.
- ❌ **shadcn template** — the default `bg-card border rounded-lg` lookalike
  that AI assistants converge to.
- ❌ **A monitoring dashboard** — dark navy + neon graphs. We're not Datadog.
- ❌ **A music app** — no waveform-as-hero. Audio is a tool here, not content.

What it *is* allowed to nod toward:

- ✓ Console-like density and tabular numerals (think `htop`, `gh` CLI)
- ✓ Editorial typographic restraint when the transcript is the content
- ✓ Single solid accent — never gradient

## Strategic principles

- **Visible state over inferred state.** If the model isn't loaded, say so.
  Don't let the user click and wonder.
- **A row can be the affordance.** Don't wrap everything in a card. A list of
  jobs is a list, not 30 nested rounded rectangles.
- **Hover is a hint, click is the action.** No hover-to-show-actions on touch
  devices; primary actions always visible.
- **Time is text.** Format relative time in copy (`5분 전`), reserve mono for
  HH:MM:SS timecodes.
- **Color marks state, not decoration.** Accent = "interactive / active",
  green = "succeeded", red = "failed". Nothing else is colored on purpose.
