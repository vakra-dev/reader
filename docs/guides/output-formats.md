# Output Formats Guide

Reader supports four output formats: Markdown, HTML, JSON, and plain text.

## Overview

| Format | Best For | Features |
|--------|----------|----------|
| **markdown** | LLMs, documentation | Clean formatting, headers, links |
| **html** | Web display, archiving | Complete document with CSS |
| **json** | APIs, data processing | Structured data, metadata |
| **text** | Search indexing, NLP | Pure text, no formatting |

## Requesting Formats

### Single Format

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
});

console.log(result.data[0].markdown);
await reader.close();
```

### Multiple Formats

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "text", "json"],
});

console.log(result.data[0].markdown);
console.log(result.data[0].text);
console.log(result.data[0].json);
await reader.close();
```

### CLI

```bash
# Single format
npx reader scrape https://example.com -f markdown

# Multiple formats
npx reader scrape https://example.com -f markdown,text,json
```

## Markdown Format

Best for LLM consumption and documentation.

### Features

- Clean heading hierarchy
- Preserved links and images
- Code blocks with syntax hints
- Tables converted from HTML
- Lists (ordered and unordered)

### Example Output

```markdown
---
url: https://example.com
title: Example Domain
scraped_at: 2024-01-15T10:30:00Z
duration_ms: 1523
---

# Example Domain

This domain is for use in illustrative examples in documents.

## More Information

You may use this domain in literature without prior coordination.

[More information...](https://www.iana.org/domains/example)
```

### With Metadata Disabled

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown"],
  includeMetadata: false,
});
await reader.close();
```

Output without frontmatter:

```markdown
# Example Domain

This domain is for use in illustrative examples...
```

## HTML Format

Best for web display and archiving.

### Features

- Complete HTML document
- Inline CSS styles
- Preserved structure
- Self-contained

### Example Output

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Example Domain</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    /* ... more styles ... */
  </style>
</head>
<body>
  <header>
    <p>Scraped from: <a href="https://example.com">https://example.com</a></p>
    <p>Scraped at: 2024-01-15T10:30:00Z</p>
  </header>
  <main>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents.</p>
    <!-- ... rest of content ... -->
  </main>
</body>
</html>
```

## JSON Format

Best for APIs and data processing.

### Features

- Structured data
- Full metadata
- Easy to parse
- Type-safe

### Example Output

```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "scrapedAt": "2024-01-15T10:30:00Z",
  "duration": 1523,
  "content": {
    "text": "Example Domain\n\nThis domain is for use in illustrative examples...",
    "wordCount": 28
  },
  "metadata": {
    "title": "Example Domain",
    "description": null,
    "author": null,
    "language": "en",
    "openGraph": {
      "title": null,
      "description": null,
      "image": null
    },
    "twitter": {
      "card": null,
      "site": null
    }
  },
  "links": [
    {
      "text": "More information...",
      "href": "https://www.iana.org/domains/example"
    }
  ]
}
```

### Parsing JSON Output

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["json"],
});

const data = JSON.parse(result.data[0].json);
console.log("Title:", data.title);
console.log("Word count:", data.content.wordCount);
console.log("Links:", data.links.length);

await reader.close();
```

## Text Format

Best for search indexing and NLP.

### Features

- Pure text content
- No HTML or formatting
- Whitespace normalized
- Preserves hierarchy through indentation

### Example Output

```
Example Domain
==============

This domain is for use in illustrative examples in documents.

More Information
----------------

You may use this domain in literature without prior coordination.

More information: https://www.iana.org/domains/example
```

### Use Case: Search Indexing

```typescript
const reader = new ReaderClient();
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["text"],
});

// Index plain text
await searchIndex.add({
  url: result.data[0].metadata.baseUrl,
  content: result.data[0].text,
});

await reader.close();
```

## Format Comparison

### Same Content, Different Formats

**Original HTML:**
```html
<h1>Welcome</h1>
<p>Hello <strong>world</strong>!</p>
<ul>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>
```

**Markdown:**
```markdown
# Welcome

Hello **world**!

- Item 1
- Item 2
```

**Text:**
```
Welcome

Hello world!

- Item 1
- Item 2
```

**JSON:**
```json
{
  "content": {
    "text": "Welcome\n\nHello world!\n\n- Item 1\n- Item 2"
  }
}
```

## Content Cleaning

All formats benefit from content cleaning:

### What Gets Removed

- `<script>` and `<style>` tags
- Navigation elements (`<nav>`, `<header>`, `<footer>`)
- Advertisement containers
- Hidden elements (`display: none`)
- Cookie banners
- Social share buttons

### What Gets Preserved

- Main content (`<main>`, `<article>`)
- Headings and paragraphs
- Links and images
- Tables and lists
- Code blocks

## Custom Formatters

You can use the formatter functions directly:

```typescript
import {
  formatToMarkdown,
  formatToHTML,
  formatToJson,
  formatToText,
} from "@vakra-dev/reader";

// After scraping pages manually
const markdown = formatToMarkdown(
  pages,           // Array of Page objects
  "https://example.com",
  new Date().toISOString(),
  1500,            // Duration in ms
  metadata         // WebsiteMetadata
);
```

## Performance Considerations

| Format | Speed | Size |
|--------|-------|------|
| text | Fastest | Smallest |
| markdown | Fast | Small |
| json | Medium | Medium |
| html | Slowest | Largest |

For high-volume scraping, consider:
- Request only needed formats
- Use `text` for indexing
- Use `markdown` for LLMs
- Avoid `html` unless displaying

## Related Guides

- [Getting Started](../getting-started.md) - Basic usage
- [API Reference](../api-reference.md) - Full API docs
- [Architecture](../architecture.md) - How formatters work
