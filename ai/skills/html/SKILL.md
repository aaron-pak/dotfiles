---
name: html
description: Render a document, codebase, plan, spec, diff, dataset, or idea as a single self-contained HTML artifact optimized for a first-time reader. Triggers on "make an HTML version/artifact of X", including plans, specs, and diffs to review and give feedback on.
---

# HTML artifact

Create a single, self-contained HTML file for the requested subject, built for a
first-time reader: someone who has not seen the underlying code, document, or
data should be able to understand and review the subject from this page alone.
Before writing markup, decide what that reader should be able to answer within
30 seconds of opening it, and design the page around that.

What HTML buys over Markdown is a wider vocabulary of representation: tables,
timelines, diagrams, charts, side-by-side comparisons, big-number stats,
collapsible detail, interaction. For each piece of content, ask which
representation communicates it best. Much of what arrives as prose is better
shown than told — comparisons, sequences, flows, repeated items that share
fields. For a set of items that share fields, show the cross-item picture — a
ranking, tradeoff chart, or sortable view; per-item meters repeated down a grid
compare nothing. And when prose genuinely is the clearest form, keep it —
written with at least the discipline a good Markdown file would have: short
paragraphs, headings, bullets, the verdict up front.

Invent presentation freely; never content. Every number, count, and claim in
the page's own voice should trace to the source — mark what you inferred, and
leave gaps open rather than filled. Compute any count or total you display
from the data instead of writing it from memory.

Artifacts fail in two opposite directions, and both read as noise:

- Under-transformed — prose carried over as walls of text, below even the
  formatting discipline Markdown would have imposed, and pages that scroll
  forever because supporting detail was never collapsed. A paragraph that runs
  long usually has a structure hiding in it. Say each thing once — a summary
  may preview a point, but the body shouldn't restate it.
- Over-decorated — visuals, badges, or interactivity added for richness
  rather than meaning. An element that doesn't communicate something is
  clutter.

Keep the design calm and editorial: generous whitespace, a readable measure,
deliberate type (a display face for headlines, mono for labels and
identifiers), light mode by default. Within that, don't be shy with color —
use it to encode meaning, separate groups, and give the page life. Keep
encodings readable: one meaning per color, with a legend or caption wherever
the meaning isn't obvious.

When the content is something I'll give feedback on — a plan, spec, diff,
document, instructions — make it reviewable: let me highlight any text and
leave an inline comment on it, which I can edit or delete. Selections that span
formatting or multiple elements are the easy thing to get wrong here; so is
scoping — any text means headings, labels, and captions too — and so are the
unhappy paths: an abandoned comment should leave no stray highlight or stale
count. Capture any other input that fits the content too — toggles, choices,
adjustable values. Give me one control to copy everything I've entered back out
as text I can paste to you.

Keep everything in one file so it's easy to open and share. If you pull in a
remote library, make sure the page still communicates when it fails to load.
Then open the file in my default browser.

Subject: $ARGUMENTS
