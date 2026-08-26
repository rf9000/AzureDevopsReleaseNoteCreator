# Release Note Generation Rules

These rules cover what the technical writers' style guide (`changelog-style-guide.md`, beside this file)
does **not**: how to decide *what* goes into the note from PR / work-item context, product-specific
conventions that the style guide leaves implicit, reference examples, and the approval flow. Where these
rules and the style guide disagree, **the style guide wins** — this file only adds to it.

## What to write about

- **Focus on the primary change — the note is not a changelog.** A work item often touches several
  things. Lead with the single user-facing change that matters most and give it the space it needs.
  If a second, genuinely distinct user-facing change exists, keep it to a sentence. **Stop once those
  are covered** — do not append a survey of the remaining changes.
- **Never mention these, at all** (not even a clause): documentation-only changes such as tooltip or
  help-text wording; extensibility/API-surface changes such as making tables, fields, or procedures
  public; and internal refactors. A customer cannot see or act on them, so they do not belong in a
  release note. If in doubt whether a change is user-facing, leave it out.
- **Preferred shape for a changed behavior (features / user stories):** lead with the new behavior
  ("… is now …", naming the controlling setting/page in bold), then use **"Previously, …"** to contrast
  the old behavior, and finish with any action the customer must take (migration, enabling a setting)
  naming the exact UI element and where to find it. See the feature example below.
- **Prefer one paragraph.** Use a semicolon to join closely related points rather than splitting into a
  second paragraph prematurely. A second paragraph is for cases like a bug fix whose error-message block
  needs its own block.

## Product conventions not spelled out in the style guide

- **Plain text (never bold):** product and service names (`Continia Banking`, `Business Central`,
  `Document Capture`, `Azure Blob Storage`) and generic words (`field`, `page`, `option`, `column`,
  `database`). Only real, unique UI elements are bold.
- **Terminology additions:**

  | WRONG | CORRECT |
  |-------|---------|
  | business central online, Business Central Online | Business Central online |
  | cloud ocr | Cloud OCR |

## Reference examples

### Feature / changed behavior (gold standard — single paragraph, "Previously" contrast, migration note)

```html
<p>eDocument log entries are now stored in Azure Blob Storage based on the <strong>Log Storage Type</strong> setting in <strong>Document Output Setup</strong>. Previously, only email log entries were stored in Azure Blob Storage while e-document XML data was always stored in the database; existing e-document entries can be migrated by running <strong>Move Logs</strong> from <strong>Document Output Setup</strong>.</p>
```

Note: real UI elements are bold (<strong>Log Storage Type</strong>, <strong>Document Output Setup</strong>, <strong>Move Logs</strong>); the service name "Azure Blob Storage" and the generic word "database" stay plain.

### Bug fix

```html
<p>Payment exports failed when a vendor bank account holder name contained special characters such as &amp;, &lt;, or &gt;.</p>
<p>When exporting payments from the <strong>Payment Journal</strong> page with such a vendor, the following error occurred:</p>
<ul><li><em>XML parsing error: Invalid character in element content.</em></li></ul>
<p>This has been fixed. Special characters are now escaped during file generation, so the export completes successfully.</p>
```

## Additional self-check items

Run these **in addition to** the style guide's self-check, before presenting the note:

- [ ] Focused on the primary user-facing change; secondary point (if any) kept to a sentence.
- [ ] NO documentation-only changes (tooltip/help-text wording), extensibility/API-surface changes, or
      internal refactors mentioned anywhere in the note.
- [ ] Product names, service names, and generic words (field/page/option/column/database) are **not** bold.
- [ ] "Business Central online" and "Cloud OCR" are cased correctly.

## User approval

**After presenting the release note, ask:**

**Does this release note look correct?**

1 - [Yes] - Accept this release note
2 - [Modify] - Let me adjust the content
3 - [Regenerate] - Generate a new version

Wait for the user's response before proceeding.
