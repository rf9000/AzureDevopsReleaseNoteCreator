---
name: do-generate-release-note
description: Generate a Continia release note (HTML description cell) from a work item and its change context (pull request, branch or staged diff, or commits), following the technical writers' changelog style guide.
---

# Generate Continia Release Note

Write a professional release note for a Continia software update from the work item and the change
context. The note does not depend on a pull request existing — any description of *what changed* will do.

## Change context — where it comes from

Use the first source that is available, in this order:

1. **Supplied in the prompt** — pull-request title, description, changed files, and comments (this is what
   the automated flow sends), or a diff pasted by the user.
2. **The developer's repository**, when invoked interactively inside the repository that holds the change
   and nothing is supplied: the staged changes (`git diff --staged`), then the branch's diff against its
   base (`git diff <base>...HEAD`), then recent commits on the branch. Treat this diff as the change
   context, not as "reading code"; do not roam the repository beyond it.
3. **The work item alone**, when neither applies (e.g. the automated flow processing a work item with no
   linked pull request) — write from its title, description, and comments; do not search the file system
   for the change.

Read code outside the diff only when the context above is not enough to understand what changed for the
customer. If no work item is supplied and the type (bug fix or feature) cannot be inferred from the branch
name, commit messages, or diff, ask for the work item before writing — the two shapes differ too much to
guess.

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
