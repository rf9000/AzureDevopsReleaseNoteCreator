---
name: do-generate-release-note
description: Generate a Continia release note (HTML description cell) from work item and pull-request context, following the technical writers' changelog style guide.
---

# Generate Continia Release Note

Write a professional release note for a Continia software update from the provided work item and
pull-request context (title, description, changed files, comments). Read the referenced code only when
the supplied context is not enough to understand what changed for the customer.

Two documents in this skill folder govern the note. Follow both; if they ever disagree, **the style
guide wins**.

## 1. Style guide (authoritative — owned by the technical writers)

Apply every rule in the style guide below, including its self-check. The file is dropped in wholesale
whenever the writers publish a new version and is never edited here; if anything in the generation rules
(section 2) conflicts with it, the style guide is right. Ignore its trailing "Conversion report" section
and any `<!-- GAP: … -->` comments — they are notes about the guide itself, not rules for the note.

@.claude/skills/do-generate-release-note/changelog-style-guide.md

## 2. Generation rules (what to write about, product conventions, examples, approval flow)

@.claude/skills/do-generate-release-note/generation-rules.md

## Output

Present only the HTML description (per the style guide's output contract), then run the approval step
from the generation rules.
