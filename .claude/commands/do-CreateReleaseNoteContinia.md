# Create Continia Release Note

Create a professional release note for a Continia software update based on the provided code changes.

These guidelines follow Continia's official changelog style guide — the exact same guidelines used by
Continia's LLM-powered release note checker. Following them is what lets a note pass the checker.

## PURPOSE

A release note lets colleagues, partners, and customers determine whether a specific change affects
them — and, for a bug fix, whether *their* error is the one that was corrected. Write so a partner
who sees a customer's error message can match it to the note.

## OUTPUT SHAPE (CRITICAL)

The note you produce becomes the **Description** of a single row in a release-note table on the
public web page:

| Functional Area | Description (this is what you write) | ID |

The **Functional Area** and **ID** columns come from the work item — **do NOT** write them.
You output **only the description**, as **flowing-prose HTML**.

- **NO section headers.** Do not emit `<h3>` (Why/What/Impact/Resolution) or any heading. Headers
  break the table-cell rendering. The note is plain prose.
- **Prefer a single, concise paragraph.** Most notes are one `<p>...</p>` that flows the change
  together — use a semicolon to join closely related points rather than splitting prematurely. Wrap
  each paragraph in `<p>...</p>`. Add a second paragraph only when it genuinely aids readability
  (e.g. a long bug fix where the error block needs its own block).

## FORMATTING RULES (HTML)

1. **UI elements** — `<strong>`, with no quotation marks and no italics. E.g. `<strong>Deferral Code</strong>`, `<strong>Export Attachments</strong>`.
   - **Exception — non-unique UI terms are NOT bold** and keep the capitalization shown:
     cue, document card, document journal, FactBox, FastTab, Role Center.
   - Also plain text (never bold): product names (`Continia Banking`, `Business Central`,
     `Document Capture`) and generic words (`field`, `page`, `option`, `column`).
2. **Error messages** — introduce with the phrase `When <situation>, the following error occurred:`
   then **immediately** list the message(s). The message goes in a bullet list, in italics
   (`<em>`), **without quotation marks**. **Do not** put an empty paragraph or line break between
   the intro sentence and the list.
   ```html
   <p>When posting a payment without a recipient bank account, the following error occurred:</p>
   <ul><li><em>The Recipient Bank Account must have a value.</em></li></ul>
   ```
3. **Bullet lists** — use `<ul>`/`<li>` for grouped information and for error messages. Never use
   numbers or dashes.
4. **Navigation paths** — separate steps with `>`. UI segments stay bold:
   `<strong>Home</strong> &gt; <strong>Recognize Fields</strong>`.
5. **Placeholders / values** — use descriptive placeholders in HTML-escaped angle brackets:
   `&lt;Item No.&gt;`, `&lt;Document Type&gt;`. Never use hardcoded placeholders like `xxx`, `yyy`,
   `zzz`. Do not wrap values in quotation marks or parentheses.
6. **Doc links** — link to relevant Continia Docs with descriptive link text; never paste a raw URL.
   E.g. `For more information, see <a href="...">Accounts for Amounts</a>.`
7. **Cleanup** — check spelling; remove trailing spaces, empty lines, and unnecessary formatting.
   Keep the language clear, concise, and consistent.

## VOICE AND TENSE

- Use **it** ("It is now possible to…") and **you** ("You can now…"), and the **passive voice**
  ("Support for Italian has been added."). **Never use "we"** ("We've added…").
- **Features** — present or past tense ("You can now…" / "The standard field has been added…").
- **Bug fixes** — **past** tense for the error, **present** tense for the fix
  ("…the following error occurred." → "This has been fixed.").

## CONTENT GUIDANCE

- **Focus on the primary change — the note is not a changelog.** A work item often touches several
  things. Lead with the single user-facing change that matters most and give it the space it needs.
  Mention secondary changes only briefly (a clause or short sentence), and **omit purely technical or
  enabling changes** a customer cannot see or act on (e.g. tables made public for extensibility,
  internal refactors, minor tooltip wording). If two genuinely distinct user-facing changes exist,
  keep the lesser one to a sentence.
- **Features (user stories)** — explain the business value or problem being solved, what the feature
  does and why it matters, and how/when it affects customers. Avoid technical implementation detail
  unless it is genuinely relevant.
  - **Preferred shape for a changed behavior:** lead with the new behavior ("… is now …", naming the
    controlling setting/page in bold), then use **"Previously, …"** to contrast the old behavior, and
    finish with any action the customer must take (migration, enabling a setting) naming the exact UI
    element and where to find it. See the first example below.
- **Bug fixes** — clearly define the issue, specify where it occurred and under what circumstances
  (include error messages per rule 2), then give context for how it was resolved.

## TERMINOLOGY

| WRONG | CORRECT |
|-------|---------|
| On-Premises, On-premises | on-premises |
| On premises (capitalized) | on premises |
| business central online, Business Central Online | Business Central online |
| Cloud (when referring to the cloud) | cloud |
| cloud ocr | Cloud OCR |
| Continia cloud OCR, continia cloud ocr | Continia Cloud OCR |

- "on-premises" and "on premises" are always lower case ("Business Central on premises",
  "on-premises Business Central").
- "cloud" is lower case, **except** in the term "Continia Cloud OCR".
- Versions: use the full name ("Dynamics NAV 3.70") or the short notation ("BC v14"). For a solution
  version, lead with the solution name: "Document Capture 2023 R2 (12.00)".

## EXAMPLES

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

## SELF-CHECK (before presenting)

Before showing the note, re-read your generated HTML and fix any of these before presenting — do not
show the user a note that fails them:

- [ ] No `<h1>`/`<h2>`/`<h3>` or any heading tag.
- [ ] No `<ol>` / numbered or dash-prefixed bullets (use `<ul>`/`<li>` only).
- [ ] No "we", "we've", or "our" — voice is it/you/passive.
- [ ] Terminology casing correct: on-premises, on premises, Business Central online, cloud (lower
      case), Cloud OCR, Continia Cloud OCR.
- [ ] Error messages: introduced with "…the following error occurred:", in `<em>`, **no** quotation
      marks, list immediately follows (no empty paragraph/break before it).
- [ ] Placeholders use HTML-escaped angle brackets (`&lt;…&gt;`); no `xxx`/`yyy`/`zzz`; values not
      wrapped in quotation marks or parentheses.
- [ ] No raw URLs in the text — links use descriptive `<a>` text.
- [ ] Bold (`<strong>`) is used for real UI elements only; non-unique terms (cue, document card,
      document journal, FactBox, FastTab, Role Center), product names, and generic words
      (field/page/option/column) are **not** bold.
- [ ] Focused on the primary user-facing change; secondary points kept brief and pure implementation
      details (extensibility, refactors) omitted.
- [ ] Reads as concise flowing prose (prefer one paragraph); no trailing spaces or empty lines.

## USER APPROVAL

**After presenting the release note, ask:**

**Does this release note look correct?**

1 - [Yes] - Accept this release note
2 - [Modify] - Let me adjust the content
3 - [Regenerate] - Generate a new version

Wait for the user's response before proceeding.
