# Create Continia Release Note

Create professional release notes for Continia software updates based on provided code changes.

## FORMATTING RULES (HTML)

1. **Section headers** - Use `<h3>` tags: `<h3>Why</h3>`, `<h3>What</h3>`, `<h3>Impact</h3>`, `<h3>Where/When</h3>`, `<h3>Resolution</h3>`
2. **Paragraphs** - Wrap content in `<p>` tags: `<p>Your content here.</p>`
3. **UI elements** - Use `<strong>` for field names, pages, buttons: `<strong>Bank Account Card</strong>`
4. **Error messages** - Use `<em>` for italics: `<em>The payment failed</em>`
5. **Navigation paths** - Use > with strong tags: `<strong>Departments</strong> > <strong>Banking</strong> > <strong>Setup</strong>`
6. **Values** - Angle brackets (HTML-escaped): `&lt;Item No.&gt;`, `&lt;Amount&gt;`
7. **Bullet lists** - Use `<ul>` and `<li>`: `<ul><li>First item</li><li>Second item</li></ul>`
8. **Voice** - Use "It", "You", or passive. NEVER use "We"
9. **Doc links** - Format: `For further information see <a href="url">Article</a> on the <strong>Page</strong>.`

## TERMINOLOGY

| WRONG | CORRECT |
|-------|---------|
| On-Premises, On-premises | on-premises |
| business central online | Business Central online |
| Business Central Online | Business Central online |
| cloud ocr | Cloud OCR |
| Continia cloud OCR | Continia Cloud OCR |

## EXAMPLES

### Feature

```html
<h3>Why</h3>
<p>Partners integrating with Nordic banks need PSD2-compliant authentication that handles token refresh automatically.</p>

<h3>What</h3>
<p>A new OAuth2 authentication flow has been added that manages the complete authorization process, including automatic token refresh and secure credential storage using the <strong>Isolated Storage</strong> API.</p>

<h3>Impact</h3>
<p>You can now connect to Nordea bank accounts directly from the <strong>Bank Account Card</strong> page without manual token management.</p>
```

### Bug Fix

```html
<h3>What</h3>
<p>Payment exports failed when the vendor bank account contained special characters in the account holder name.</p>

<h3>Where/When</h3>
<p>This occurred on the <strong>Payment Journal</strong> page when using the <strong>Export Payments</strong> action with vendors whose bank accounts had names containing characters like &amp;, &lt;, or &gt;.</p>
<p>The following error could appear:</p>
<ul>
<li><em>XML parsing error: Invalid character in element content</em></li>
</ul>

<h3>Resolution</h3>
<p>Special characters are now properly escaped during XML generation, allowing payment exports to complete successfully.</p>
```

## OUTPUT

Return ONLY the HTML release note content. No markdown, no code fences, no explanation — just the raw HTML starting with the first `<h3>` tag.

**CRITICAL**: Your FINAL message must contain ONLY the raw HTML. Do NOT add any summary, commentary, or explanation before or after the HTML. Do NOT say things like "Here's the release note" or "The release note has been generated". Just output the HTML and nothing else.
