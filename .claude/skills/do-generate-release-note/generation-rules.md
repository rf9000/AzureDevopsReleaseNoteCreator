# Release Note Generation Rules

These rules cover what the technical writers' style guide (`changelog-style-guide.md`, beside this file)
does **not**: how to decide *what* goes into the note from the change and work-item context (pull request,
diff, or work item alone), how long it should be,
product-specific conventions that the style guide leaves implicit, reference examples, and the approval
flow. Where these rules and the style guide disagree, **the style guide wins** — this file only adds to it.

> **Maintenance note.** The style guide is owned by the technical writers and is dropped in wholesale
> whenever they publish a new version; it is never edited here. Wherever this file mentions what the guide
> says (tense rule, error-message rule, paragraph rule), it is paraphrasing the guide **as of 2026-08-27**
> so the examples below can illustrate length. If the guide changes, the guide is right and this file is
> stale — re-check the "Shapes", "Reference examples", and "Additional self-check" sections against it.

## Length budget (the most common failure is writing too much)

Published Continia release notes are short. Across the Continia Banking 2026 R1 changelog, half of all
notes are **one sentence**, most of the rest are **two**, and the median note is **21 words**. Match that:

- **Features: default to one sentence**, two when the business value needs its own sentence. **Bug fixes:
  two sentences** — the problem (with where/when) and the fix, in the tenses the style guide prescribes —
  plus the error-message list when one is available. **Three sentences is the ceiling**; never write four.
- **Target 15–35 words of prose; hard stop at 50.** Quoted error-message text does not count. If the draft
  is longer, cut detail — do not compress by chaining clauses with semicolons.
- Paragraphs: exactly as the style guide's output contract says — do not add paragraphs for length or
  emphasis.
- State the business value the way the style guide asks — *why it matters to the customer* — but in one
  short clause or sentence ("… to help prevent communication failures caused by expired tokens"), not a
  paragraph of motivation.
- Do not describe mechanism or implementation (which codeunit, which event, how it is detected). State
  the user-visible outcome only — the style guide's "not the implementation".

## What to write about

- **The one primary user-facing change.** A work item often touches several things; write about the one
  a customer or partner would notice. A second, genuinely distinct user-facing change gets one clause or
  sentence at most — and only if the budget above still holds. Everything else is omitted.
- **Never mention, not even in a clause:** documentation-only changes (tooltips, help text); extensibility
  or API-surface changes such as making tables, fields, or procedures public — *unless the work item is
  itself a partner-facing API change, in which case that is the change* ("Partner extensions can now …");
  internal refactors, test changes, telemetry, and code-quality work. If in doubt whether a change is
  user-facing, leave it out.
- **"Previously, …" is rare (2 of 473 published notes).** Use it only when the old behavior cannot be
  inferred from the new one. Do not add it as a matter of course.

## Shapes that match the published corpus

**Feature / changed behavior** — one sentence, optionally a second on the effect, optionally a docs link:

- `You can now <do X> by using <strong>UI element</strong>.`
- `<strong>Setting</strong> in <strong>Page</strong> now <does X>.`
- `A new <strong>Setting</strong> in <strong>Page</strong> lets you <do X>.`
- `Partner extensions can now <do X> through a new public <codeunit/API/event>.`

**Bug fix** — apply the style guide's bug-fix content guidance, its error-message rule, and its tense rule
exactly as the guide states them; this file only says how to keep that compact. Everything the guide asks
a bug-fix note to contain fits in two sentences plus the error list:

- One sentence for the problem, covering the issue *and* where/when it occurred, in the tense the guide
  prescribes for the problem.
- The error-message list, formatted per the guide's error-message rule, when the exact text is available.
- One sentence for the resolution, in the tense the guide prescribes for the fix; the "context for how it
  was resolved" is the *outcome the user sees*, not the code change.

The published changelog often opens bug fixes with "Fixed an issue where …". Do **not** copy that: it is a
corpus habit, not a style-guide pattern, and as of the current guide it puts the fix in the wrong tense.

**Error messages.** Only quote an error message whose **exact text** appears in the supplied context —
work item, pull request, diff — or in code you read. Never paraphrase, translate, or reconstruct one — a
wrong message is worse than none, because partners match on it. When no exact text is available, write the
bug fix without the list. A message that the change *introduces* (a new label in the diff) is post-fix
behavior, not the error that occurred; it never goes in the "the following error occurred" list.

## Product conventions not spelled out in the style guide

- **Plain text (never bold):** product and service names (`Continia Banking`, `Business Central`,
  `Document Capture`, `Azure Blob Storage`, `Yapily`, `BANKSapi`) and generic words (`field`, `page`,
  `option`, `column`, `database`, `job queue`). Only real, unique UI elements are bold.
- **Terminology additions:**

  | WRONG | CORRECT |
  |-------|---------|
  | business central online, Business Central Online | Business Central online |
  | cloud ocr | Cloud OCR |

## Reference examples

Feature examples are verbatim from the published Continia Banking 2026 R1 changelog. Bug-fix examples are
the same published changes rewritten to the style guide's pattern (the published rows use a "Fixed an issue
where …" opening that the guide does not sanction).

Feature, one sentence:

```html
<p>You can now merge multiple CSV column values into a single field by configuring a connector in the column mapping.</p>
```

Feature, setting on a page:

```html
<p>A new <strong>Summarize per Account</strong> setting in <strong>Payment Journal Setup</strong> lets you define the default summarization behavior for payment suggestions.</p>
```

Feature, two sentences (second states the effect):

```html
<p>OAuth access tokens for direct-communication bank systems are now refreshed automatically through a scheduled background job. This helps prevent communication interruptions caused by expired tokens.</p>
```

Partner-facing API change:

```html
<p>Partner extensions can now validate payment references through a new public API that uses the same validation logic as Continia Banking.</p>
```

Bug fix, no error message available (issue + where/when, then the fix):

```html
<p>When remittance advice emails were sent through a job queue, the same email could be sent repeatedly. This has been fixed, and each remittance advice is now sent once.</p>
```

Bug fix with UI elements:

```html
<p>When <strong>Applied Pmt. Tolerance</strong> was changed on the <strong>Apply Ledger Entries</strong> page, the entries were not reapplied and the difference total was not updated. This has been fixed.</p>
```

Bug fix with an error message, following the style guide's error-message rule. (The message text below is
invented for illustration only — in a real note it must be the exact text from the supplied context.)

```html
<p>When deleting related payment lines in the <strong>Payment Journal</strong>, lines that had already been exported were also deleted, and the following error occurred:</p>
<ul><li><em>The payment line has already been exported.</em></li></ul>
<p>This has been fixed. Exported lines are now excluded from deletion.</p>
```

## Additional self-check items

Run these **in addition to** the style guide's self-check, before presenting the note:

- [ ] At most three sentences; at most 50 words of prose, not counting quoted error text (count them).
- [ ] Bug fix: tense follows the style guide's tense rule; the note does not open with the corpus habit
      "Fixed an issue where …".
- [ ] Bug fix: the error message is included (per the style guide's rule) when its exact text was available
      in the context; it is never paraphrased or invented.
- [ ] Focused on the one primary user-facing change; no survey of the other changes in the work item.
- [ ] NO documentation-only changes, internal refactors, telemetry, tests, or (unless the work item *is*
      a partner API) API-surface changes mentioned anywhere.
- [ ] No implementation detail (codeunit names, events, detection logic) — outcome only.
- [ ] "Previously, …" only if the old behavior is genuinely needed to understand the change.
- [ ] Product names, service names, and generic words are **not** bold.
- [ ] "Business Central online" and "Cloud OCR" are cased correctly.

## User approval

**After presenting the release note, ask:**

**Does this release note look correct?**

1 - [Yes] - Accept this release note
2 - [Modify] - Let me adjust the content
3 - [Regenerate] - Generate a new version

Wait for the user's response before proceeding.
