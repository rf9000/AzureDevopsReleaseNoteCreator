# One-time categorized failure comment on tagged work items

**Date:** 2026-07-08
**Status:** Approved

## Problem

The tag-driven release-note flow (`scanTaggedWorkItems` → `processTaggedWorkItem`)
is project-wide: any work item in the ADO project tagged `create-releasenote` is
picked up, regardless of product or repo. As this widens from the original
Continia Banking team to other product teams (Document Capture, etc.), failures
become invisible to the people who tagged the item.

Today, when `processTaggedWorkItem` fails, the tag is deliberately left in place
so the item retries on the next poll, and the error is written only to the tool
logs. A person in another product team who tags an item and gets no release note
has no way to learn why — they don't see the logs.

## Goal

When a tagged work item fails to process, post a **short, friendly, categorized**
comment to the work item explaining what happened and that it will retry — posted
**once per failure category**, never re-spammed on every poll, and without leaking
raw API/error text onto the work item.

## Non-goals

- Surfacing soft warnings that do **not** fail the item (e.g. a linked PR whose
  files/comments could not be read). Those are non-fatal today — the note still
  generates from available context — and elevating them is a separate, larger
  change with double-comment risk on successful-but-degraded notes.
- Adding a "done"/success tag. Explicitly declined.
- Any new `.env` / configuration. Signatures and messages are code constants.
- Changing the tag lifecycle: the trigger tag still stays on for auto-retry.

## Failure categories

The category is determined by **which phase threw**, not by parsing the error
message. Only two operations in `processTaggedWorkItem` throw into the outer
`catch` (PR-context gathering and work-item-comment fetching are already wrapped
as non-fatal):

| Category   | Thrown by                          | Meaning                                             |
|------------|------------------------------------|-----------------------------------------------------|
| `generate` | `generateReleaseNote`              | SDK/auth error, or the agent produced no valid HTML |
| `save`     | `updateWorkItemFields` (any call)  | Permissions or work-item-state problem on write     |

Implementation: a `category` variable in `processTaggedWorkItem`, initialized to
`'generate'`, flipped to `'save'` immediately before the ADO write section
(including the closed-item reopen path, whose two `updateWorkItemFields` calls are
both `save`). The `catch` block reads this variable.

## Comment text

Short and friendly. HTML-formatted to match the existing docsWriter comment style.

- **generate:**
  `⚠️ <b>Release-note tool couldn't generate a release note here.</b><br/>It will retry automatically on the next poll.`
- **save:**
  `⚠️ <b>Release-note tool generated a note but couldn't save it to this work item</b> — likely a permissions or state issue.<br/>It will retry automatically.`

Raw error detail is **not** included in the comment; it continues to go to the
logs (the existing `log(...Error — ${err})` line is retained).

## Repeat-suppression (stateless)

The tag-driven flow is deliberately stateless — `StateStore` tracks only PR IDs,
and tag removal is its sole idempotency mechanism (`watcher.ts` comment). This
design preserves that: no per-work-item state is added.

Before posting, scan the work item's existing comments for the category's
**signature substring** (case-insensitive). Signatures are apostrophe-free,
category-specific cores of the visible text, so they survive whatever HTML
rendering ADO applies:

| Category   | Signature substring          |
|------------|------------------------------|
| `generate` | `generate a release note`    |
| `save`     | `save it to this work item`  |

Behavior:

- Signature for the current category already present → **skip**, log
  `failure comment already present (<category>)`.
- Not present → **post** the comment.
- Re-comments only when the failure category *changes* (e.g. `generate` → `save`),
  which is genuinely new information.
- Comment **read** itself fails → log a warning and **skip posting** (cannot
  verify → do not risk a duplicate; the failure is already logged).
- **Dry-run** → never posts; logs `[DRY RUN] would post failure comment (<category>)`.

## Components / changes

### `src/sdk/azure-devops-client.ts`
Add `addWorkItemComment(config, workItemId, commentHtml)`, ported from docsWriter:
`POST wit/workitems/{id}/comments` via the existing `adoFetchWithRetry`, using this
repo's `7.0-preview.3` api-version (matching the existing `getWorkItemComments`).
Return type may be `void` or a minimal typed response.

### `src/services/work-item-processor.ts`
- Add `addWorkItemComment` to `WorkItemProcessorDeps` and `defaultDeps`
  (`getWorkItemComments` is already a dep and is reused for the scan).
- Add `FailureCategory = 'generate' | 'save'` and the signature/message constants.
- Add a `postFailureCommentOnce(config, workItemId, category, deps)` helper
  implementing the scan-then-post logic above.
- Track the `category` variable through `processTaggedWorkItem` and call the
  helper from the `catch` block (in addition to the existing `result.errors++`
  and log line; the tag is still left in place).

### `tests/services/work-item-processor.test.ts`
- `generate` failure → posts the `generate` comment; tag NOT removed.
- `save` failure → posts the `save` comment.
- Signature for same category already present → does **not** post again.
- A *different* category's signature present → still posts.
- Dry-run → does not post.
- Comment-read failure → does not post (and does not throw).

## Data flow

```
processTaggedWorkItem
  category = 'generate'
  gather PR context        (non-fatal)
  gather WI comments       (non-fatal)
  note = generateReleaseNote()      ── throws ─┐  (category = 'generate')
  category = 'save'                            │
  updateWorkItemFields(...)          ── throws ┤  (category = 'save')
                                               ▼
  catch:
    result.errors++
    log("Error — <raw err>")                    (logs keep full detail)
    postFailureCommentOnce(category):
       read WI comments
         └ read fails → log + skip
       signature(category) present? → skip
       dry-run?                     → log + skip
       else → addWorkItemComment(message(category))
    (tag left in place → retries next poll)
```

## Testing strategy

TDD via the injected `WorkItemProcessorDeps`: supply mock `generateReleaseNote`
/ `updateWorkItemFields` that throw to drive each category, and mock
`getWorkItemComments` / `addWorkItemComment` to assert scan-and-post behavior.
No live ADO calls.
