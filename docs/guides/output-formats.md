# Output Formats

Reader supports two output formats: **Markdown** and **HTML**.

| Format | Best For | What You Get |
|--------|----------|-------------|
| **markdown** | LLM consumption, RAG pipelines | Clean markdown with headings, lists, links |
| **html** | Rendering, further processing | Cleaned HTML with semantic structure |

## Specifying Formats

```typescript
const result = await reader.scrape({
  urls: ["https://example.com"],
  formats: ["markdown", "html"],
});

console.log(result.data[0].markdown);
console.log(result.data[0].html);
```

### CLI

```bash
npx reader scrape https://example.com -f markdown,html
```

Default format is `["markdown"]` if not specified.

## Markdown Output

Markdown is the recommended format for LLM consumption. Reader uses [supermarkdown](https://github.com/vakra-dev/supermarkdown), a Rust-based HTML to markdown converter built specifically for web scraping and LLM pipelines.

Features:
- Full GitHub Flavored Markdown (GFM) support
- Tables, task lists, strikethrough, autolinks
- Handles malformed HTML from real web pages
- LLM-optimized output (clean, no artifacts)

## HTML Output

HTML output is the cleaned, semantic HTML after content extraction. It includes:
- Main content only (nav/header/footer removed when `onlyMainContent: true`)
- Scripts, styles, and hidden elements removed
- Base64 images stripped
- URLs resolved to absolute paths

## Content Cleaning

Both formats benefit from the content cleaning pipeline:

```typescript
// Extract only main content (default)
await reader.scrape({ urls, onlyMainContent: true });

// Include specific elements only
await reader.scrape({ urls, includeTags: [".article-body"] });

// Exclude specific elements
await reader.scrape({ urls, excludeTags: [".comments", ".sidebar"] });

// Full page (no cleaning)
await reader.scrape({ urls, onlyMainContent: false });
```

## Metadata

Every scrape result includes metadata regardless of format:

```typescript
result.data[0].metadata.website.title       // Page title
result.data[0].metadata.website.description // Meta description
result.data[0].metadata.website.language    // Language
result.data[0].metadata.baseUrl             // Original URL
result.data[0].metadata.finalUrl            // URL after redirects (if different)
result.data[0].metadata.statusCode          // HTTP status
result.data[0].metadata.duration            // Scrape duration (ms)
```
