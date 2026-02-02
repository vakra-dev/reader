# Contributing to Reader

Thank you for your interest in contributing to Reader! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- **Node.js** >= 18 (v22 recommended)
- **npm** for package management
- **Git**

> **Note:** Always run scripts with Node.js (`npx tsx` or `node`) as Hero has ESM compatibility issues with other runtimes.

### Getting Started

1. **Fork the repository** on GitHub

2. **Clone your fork:**

   ```bash
   git clone https://github.com/YOUR_USERNAME/reader.git
   cd reader
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

4. **Verify setup:**

   ```bash
   npm run typecheck
   npm run build
   ```

5. **Test the CLI:**
   ```bash
   npx tsx src/cli/index.ts scrape https://example.com
   ```

## Project Structure

```
src/
├── index.ts              # Public API exports
├── client.ts             # ReaderClient - main API entry point
├── scraper.ts            # Scraper class - main scraping logic
├── crawler.ts            # Crawler class - link discovery
├── types.ts              # TypeScript types for scraping
├── crawl-types.ts        # TypeScript types for crawling
│
├── browser/
│   ├── pool.ts           # BrowserPool - manages Hero instances
│   ├── hero-config.ts    # Hero configuration
│   └── types.ts          # Pool types
│
├── cloudflare/
│   ├── detector.ts       # Challenge detection
│   ├── handler.ts        # Challenge resolution
│   └── types.ts          # Cloudflare types
│
├── formatters/
│   ├── markdown.ts       # Markdown formatter
│   ├── html.ts           # HTML formatter
│   ├── json.ts           # JSON formatter
│   ├── text.ts           # Text formatter
│   └── index.ts          # Re-exports
│
├── utils/
│   ├── content-cleaner.ts    # HTML content cleaning
│   ├── metadata-extractor.ts # Metadata extraction
│   ├── url-helpers.ts        # URL utilities
│   ├── rate-limiter.ts       # Rate limiting
│   └── logger.ts             # Logging
│
├── proxy/
│   └── config.ts         # Proxy configuration
│
├── daemon/
│   ├── index.ts          # Module exports
│   ├── server.ts         # DaemonServer - HTTP server with browser pool
│   └── client.ts         # DaemonClient - connects CLI to daemon
│
└── cli/
    └── index.ts          # CLI implementation
```

## Development Workflow

### Running the CLI

```bash
# Run CLI directly
npx tsx src/cli/index.ts scrape https://example.com

# With verbose output
npx tsx src/cli/index.ts scrape https://example.com -v

# Show browser window
npx tsx src/cli/index.ts scrape https://example.com --show-chrome
```

### Daemon Mode

```bash
# Start daemon with browser pool
npx tsx src/cli/index.ts start --pool-size 5

# Check daemon status
npx tsx src/cli/index.ts status

# Run commands (auto-connects to daemon)
npx tsx src/cli/index.ts scrape https://example.com

# Force standalone mode (bypass daemon)
npx tsx src/cli/index.ts scrape https://example.com --standalone

# Stop daemon
npx tsx src/cli/index.ts stop
```

### Code Quality

Run these commands before submitting a PR:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check

# Build
npm run build
```

### Finding TODOs

Track outstanding work:

```bash
npm run todo
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Commit Messages

Write clear, concise commit messages:

```
type: short description

Longer description if needed.
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:

```
feat: add support for custom user agents
fix: resolve timeout issue with Cloudflare challenges
docs: update proxy configuration guide
refactor: simplify browser pool recycling logic
```

### Pull Request Process

1. Create a new branch from `main`
2. Make your changes
3. Run all checks:
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run build
   ```
4. Push your branch and create a PR
5. Fill out the PR template
6. Wait for review

## Common Tasks

### Adding a New Output Format

1. Create `src/formatters/newformat.ts`:

   ```typescript
   export function formatToNewFormat(
     pages: Page[],
     baseUrl: string,
     scrapedAt: string,
     duration: number,
     metadata?: WebsiteMetadata
   ): string {
     // Implementation
   }
   ```

2. Export from `src/formatters/index.ts`

3. Add to format type in `src/types.ts`

4. Call formatter in `src/scraper.ts`

5. Update CLI validation in `src/cli/index.ts`

### Adding a New ScrapeOption

1. Add to `ScrapeOptions` interface in `src/types.ts`
2. Add default in `DEFAULT_OPTIONS`
3. Use in `Scraper` class via `this.options.newOption`
4. Add CLI flag in `src/cli/index.ts` if applicable
5. Update documentation

### Modifying Cloudflare Detection

1. Detection patterns: `src/cloudflare/detector.ts`
2. Resolution logic: `src/cloudflare/handler.ts`
3. Test with known Cloudflare-protected sites

### Adjusting Browser Pool

1. Default config: `src/browser/types.ts`
2. Pool logic: `src/browser/pool.ts`

## Testing

Currently testing is done manually. When adding new features:

1. **Test basic functionality:**

   ```bash
   npx tsx src/cli/index.ts scrape https://example.com
   ```

2. **Test Cloudflare-protected sites:**

   ```bash
   npx tsx src/cli/index.ts scrape https://cloudflare-protected-site.com -v
   ```

3. **Test different output formats:**

   ```bash
   npx tsx src/cli/index.ts scrape https://example.com -f markdown,html,json,text
   ```

4. **Test crawling:**

   ```bash
   npx tsx src/cli/index.ts crawl https://example.com -d 2 -m 10
   ```

5. **Test batch scraping:**

   ```bash
   npx tsx src/cli/index.ts scrape url1 url2 url3 -c 3 -v
   ```

6. **Test daemon mode:**

   ```bash
   # Start daemon
   npx tsx src/cli/index.ts start --pool-size 3

   # Test scraping via daemon
   npx tsx src/cli/index.ts scrape https://example.com

   # Check status
   npx tsx src/cli/index.ts status

   # Stop daemon
   npx tsx src/cli/index.ts stop
   ```

## Running Examples

The `examples/` folder contains working examples:

```bash
cd examples
npm install

# Basic examples
npx tsx basic/basic-scrape.ts
npx tsx basic/batch-scrape.ts
npx tsx basic/crawl-website.ts

# AI integration examples (requires API keys)
export OPENAI_API_KEY="sk-..."
npx tsx ai-tools/openai-summary.ts https://example.com

# Production server
npx tsx production/express-server/src/index.ts
```

## Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Use async/await instead of callbacks
- Prefer explicit types over `any`
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

## Documentation

When making changes:

1. Update relevant markdown files in `docs/`
2. Update README.md if adding new features
3. Add JSDoc comments to new public functions
4. Update CLAUDE.md for AI context if architecture changes

### Documentation Files

| File                      | Purpose                         |
| ------------------------- | ------------------------------- |
| `README.md`               | Main documentation, quick start |
| `CONTRIBUTING.md`         | This file                       |
| `docs/getting-started.md` | Detailed setup guide            |
| `docs/api-reference.md`   | Complete API docs               |
| `docs/architecture.md`    | System design                   |
| `docs/troubleshooting.md` | Common issues                   |
| `docs/guides/`            | Feature guides                  |
| `docs/deployment/`        | Deployment guides               |

## Reporting Issues

When reporting bugs, please include:

- Operating system and version
- Node.js version (`node --version`)
- Reader version
- Steps to reproduce
- Expected vs actual behavior
- Error messages and stack traces
- Verbose output (`-v` flag)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow project guidelines

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

## Disclaimer

By using Reader, you agree to the following:

- You are solely responsible for respecting websites' policies when scraping and crawling
- You will adhere to applicable privacy policies and terms of use before initiating scraping activities
- Reader respects robots.txt directives by default, but ultimate compliance is your responsibility

## Questions?

- Check the [documentation](https://docs.reader.dev)
- Search [GitHub Issues](https://github.com/vakra-dev/reader/issues)
- Ask in [Discord](https://discord.gg/6tjkq7J5WV)
- Open a new issue or discussion

Thank you for contributing!
