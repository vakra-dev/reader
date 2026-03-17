#!/usr/bin/env node
/**
 * Reader CLI
 *
 * Command-line interface for web scraping with Cloudflare bypass.
 *
 * @example
 * # Start daemon (once)
 * npx reader start --pool-size 5
 *
 * # Scrape a single URL (auto-detects daemon)
 * npx reader scrape https://example.com
 *
 * # Scrape multiple URLs with markdown and text output
 * npx reader scrape https://example.com https://example.org -f markdown,text
 *
 * # Crawl a website
 * npx reader crawl https://example.com -d 2 -m 20
 *
 * # Force standalone mode (bypass daemon)
 * npx reader scrape https://example.com --standalone
 *
 * # Check daemon status
 * npx reader status
 *
 * # Stop daemon
 * npx reader stop
 */

import { Command } from "commander";
import { ReaderClient } from "../client";
import { DaemonServer, DaemonClient, isDaemonRunning, getDaemonInfo, DEFAULT_DAEMON_PORT } from "../daemon";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Get version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

const program = new Command();

program
  .name("reader")
  .description(
    "Production-grade web scraping engine for LLMs. Clean markdown output, ready for your agents."
  )
  .version(pkg.version);

// =============================================================================
// Daemon Commands
// =============================================================================

program
  .command("start")
  .description("Start the reader daemon server")
  .option("-p, --port <n>", `Port to listen on (default: ${DEFAULT_DAEMON_PORT})`, String(DEFAULT_DAEMON_PORT))
  .option("--pool-size <n>", "Browser pool size", "5")
  .option("--show-chrome", "Show browser windows for debugging")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (options) => {
    const port = parseInt(options.port, 10);

    // Check if daemon is already running
    if (await isDaemonRunning(port)) {
      console.error(`Error: Daemon is already running on port ${port}`);
      process.exit(1);
    }

    const daemon = new DaemonServer({
      port,
      poolSize: parseInt(options.poolSize, 10),
      verbose: options.verbose || false,
      showChrome: options.showChrome || false,
    });

    try {
      await daemon.start();
      console.log(`Reader daemon started on port ${port} with pool size ${options.poolSize}`);
      console.log(`Use "npx reader stop" to stop the daemon`);

      // Keep process running
      process.on("SIGINT", async () => {
        console.log("\nShutting down daemon...");
        await daemon.stop();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        await daemon.stop();
        process.exit(0);
      });
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("stop")
  .description("Stop the running reader daemon")
  .option("-p, --port <n>", `Daemon port (default: ${DEFAULT_DAEMON_PORT})`, String(DEFAULT_DAEMON_PORT))
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const client = new DaemonClient({ port });

    try {
      if (!(await client.isRunning())) {
        console.log("Daemon is not running");
        return;
      }

      await client.shutdown();
      console.log("Daemon stopped");
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Check daemon status")
  .option("-p, --port <n>", `Daemon port (default: ${DEFAULT_DAEMON_PORT})`, String(DEFAULT_DAEMON_PORT))
  .action(async (options) => {
    // First check PID file
    const daemonInfo = await getDaemonInfo();

    if (!daemonInfo) {
      console.log("Daemon is not running");
      return;
    }

    // Use port from options if specified, otherwise from PID file
    const port = options.port ? parseInt(options.port, 10) : daemonInfo.port;

    // Verify it's actually running by connecting
    const client = new DaemonClient({ port });
    try {
      const status = await client.status();
      console.log("Daemon is running:");
      console.log(`  Port: ${status.port}`);
      console.log(`  PID: ${status.pid}`);
      console.log(`  Pool size: ${status.poolSize}`);
      console.log(`  Uptime: ${Math.round(status.uptime / 1000)}s`);
    } catch {
      console.log("Daemon is not running (stale PID file)");
    }
  });

// =============================================================================
// Scrape Command
// =============================================================================

program
  .command("scrape <urls...>")
  .description("Scrape one or more URLs")
  .option(
    "-f, --format <formats>",
    "Content formats to include (comma-separated: markdown,html)",
    "markdown"
  )
  .option("-o, --output <file>", "Output file (stdout if omitted)")
  .option("-c, --concurrency <n>", "Parallel requests", "1")
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "30000")
  .option("--proxy <url>", "Proxy URL (e.g., http://user:pass@host:port)")
  .option("--user-agent <string>", "Custom user agent string")
  .option("--batch-timeout <ms>", "Total timeout for entire batch operation", "300000")
  .option("--show-chrome", "Show browser window for debugging")
  .option("--standalone", "Force standalone mode (bypass daemon)")
  .option("-p, --port <n>", `Daemon port (default: ${DEFAULT_DAEMON_PORT})`, String(DEFAULT_DAEMON_PORT))
  .option("-v, --verbose", "Enable verbose logging")
  .option("--no-main-content", "Disable main content extraction (include full page)")
  .option("--include-tags <selectors>", "CSS selectors for elements to include (comma-separated)")
  .option("--exclude-tags <selectors>", "CSS selectors for elements to exclude (comma-separated)")
  .option("--engine <name>", "Force a specific engine (http, tlsclient, hero)")
  .option("--skip-engine <names>", "Skip specific engines (comma-separated: http,tlsclient,hero)")
  .action(async (urls: string[], options) => {
    const port = parseInt(options.port, 10);
    const useStandalone = options.standalone || false;

    // Auto-detect daemon unless --standalone is specified
    let useDaemon = false;
    if (!useStandalone) {
      useDaemon = await isDaemonRunning(port);
      if (options.verbose && useDaemon) {
        console.error(`Using daemon on port ${port}`);
      }
    }

    // Create client (daemon or standalone)
    const daemonClient = useDaemon ? new DaemonClient({ port }) : null;
    const standaloneClient = !useDaemon
      ? new ReaderClient({
          verbose: options.verbose || false,
          showChrome: options.showChrome || false,
        })
      : null;

    try {
      const formats = options.format.split(",").map((f: string) => f.trim());

      // Validate formats
      const validFormats = ["markdown", "html"];
      for (const format of formats) {
        if (!validFormats.includes(format)) {
          console.error(
            `Error: Invalid format "${format}". Valid formats: ${validFormats.join(", ")}`
          );
          process.exit(1);
        }
      }

      if (options.verbose) {
        console.error(`Scraping ${urls.length} URL(s)...`);
        console.error(`Formats: ${formats.join(", ")}`);
      }

      // Parse tag selectors
      const includeTags = options.includeTags
        ? options.includeTags.split(",").map((s: string) => s.trim())
        : undefined;
      const excludeTags = options.excludeTags
        ? options.excludeTags.split(",").map((s: string) => s.trim())
        : undefined;

      // Parse engine options
      const skipEngines = options.skipEngine
        ? options.skipEngine.split(",").map((s: string) => s.trim())
        : undefined;

      const scrapeOptions = {
        urls,
        formats,
        batchConcurrency: parseInt(options.concurrency, 10),
        timeoutMs: parseInt(options.timeout, 10),
        batchTimeoutMs: parseInt(options.batchTimeout, 10),
        proxy: options.proxy ? { url: options.proxy } : undefined,
        userAgent: options.userAgent,
        verbose: options.verbose || false,
        showChrome: options.showChrome || false,
        // Content cleaning options
        onlyMainContent: options.mainContent !== false, // --no-main-content sets this to false
        includeTags,
        excludeTags,
        // Engine options
        forceEngine: options.engine,
        skipEngines,
        onProgress: options.verbose
          ? ({ completed, total, currentUrl }: { completed: number; total: number; currentUrl: string }) => {
              console.error(`[${completed}/${total}] ${currentUrl}`);
            }
          : undefined,
      };

      const result = useDaemon
        ? await daemonClient!.scrape(scrapeOptions)
        : await standaloneClient!.scrape(scrapeOptions);

      // Always output JSON
      const output = JSON.stringify(result, null, 2);

      // Write output
      if (options.output) {
        writeFileSync(options.output, output);
        if (options.verbose) {
          console.error(`Output written to ${options.output}`);
        }
      } else {
        console.log(output);
      }

      // Print summary to stderr
      if (options.verbose) {
        console.error(`\nSummary:`);
        console.error(
          `  Successful: ${result.batchMetadata.successfulUrls}/${result.batchMetadata.totalUrls}`
        );
        console.error(`  Duration: ${result.batchMetadata.totalDuration}ms`);
      }

      // Exit with error code if any URLs failed
      if (result.batchMetadata.failedUrls > 0) {
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    } finally {
      if (standaloneClient) {
        await standaloneClient.close();
        process.exit(0);
      }
    }
  });

// =============================================================================
// Crawl Command
// =============================================================================

program
  .command("crawl <url>")
  .description("Crawl a website to discover and optionally scrape pages")
  .option("-d, --depth <n>", "Maximum crawl depth", "1")
  .option("-m, --max-pages <n>", "Maximum pages to discover", "20")
  .option("-s, --scrape", "Also scrape content of discovered pages")
  .option("-f, --format <formats>", "Content formats when scraping (comma-separated: markdown,html)", "markdown")
  .option("-o, --output <file>", "Output file (stdout if omitted)")
  .option("--delay <ms>", "Delay between requests in milliseconds", "1000")
  .option("-t, --timeout <ms>", "Total timeout for crawl operation in milliseconds")
  .option("--include <patterns>", "URL patterns to include (comma-separated regex)")
  .option("--exclude <patterns>", "URL patterns to exclude (comma-separated regex)")
  .option("--proxy <url>", "Proxy URL (e.g., http://user:pass@host:port)")
  .option("--user-agent <string>", "Custom user agent string")
  .option("--show-chrome", "Show browser window for debugging")
  .option("--standalone", "Force standalone mode (bypass daemon)")
  .option("-p, --port <n>", `Daemon port (default: ${DEFAULT_DAEMON_PORT})`, String(DEFAULT_DAEMON_PORT))
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (url: string, options) => {
    const port = parseInt(options.port, 10);
    const useStandalone = options.standalone || false;

    // Auto-detect daemon unless --standalone is specified
    let useDaemon = false;
    if (!useStandalone) {
      useDaemon = await isDaemonRunning(port);
      if (options.verbose && useDaemon) {
        console.error(`Using daemon on port ${port}`);
      }
    }

    // Create client (daemon or standalone)
    const daemonClient = useDaemon ? new DaemonClient({ port }) : null;
    const standaloneClient = !useDaemon
      ? new ReaderClient({
          verbose: options.verbose || false,
          showChrome: options.showChrome || false,
        })
      : null;

    try {
      if (options.verbose) {
        console.error(`Crawling ${url}...`);
        console.error(`Max depth: ${options.depth}, Max pages: ${options.maxPages}`);
      }

      // Parse include/exclude patterns
      const includePatterns = options.include
        ? options.include.split(",").map((p: string) => p.trim())
        : undefined;
      const excludePatterns = options.exclude
        ? options.exclude.split(",").map((p: string) => p.trim())
        : undefined;

      const crawlOptions = {
        url,
        depth: parseInt(options.depth, 10),
        maxPages: parseInt(options.maxPages, 10),
        scrape: options.scrape || false,
        delayMs: parseInt(options.delay, 10),
        timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
        includePatterns,
        excludePatterns,
        proxy: options.proxy ? { url: options.proxy } : undefined,
        userAgent: options.userAgent,
        verbose: options.verbose || false,
        showChrome: options.showChrome || false,
      };

      // Add formats to crawl options if scraping
      const formats = options.format.split(",").map((f: string) => f.trim());
      const crawlOptionsWithFormats = {
        ...crawlOptions,
        formats,
      };

      const result = useDaemon
        ? await daemonClient!.crawl(crawlOptionsWithFormats)
        : await standaloneClient!.crawl(crawlOptionsWithFormats);

      // Always output JSON
      const output = JSON.stringify(result, null, 2);

      // Write output
      if (options.output) {
        writeFileSync(options.output, output);
        if (options.verbose) {
          console.error(`Output written to ${options.output}`);
        }
      } else {
        console.log(output);
      }

      // Print summary to stderr
      if (options.verbose) {
        console.error(`\nSummary:`);
        console.error(`  Discovered: ${result.urls.length} URLs`);
        console.error(`  Duration: ${result.metadata.totalDuration}ms`);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    } finally {
      if (standaloneClient) {
        await standaloneClient.close();
        process.exit(0);
      }
    }
  });

// =============================================================================
// Session Commands
// =============================================================================

/**
 * Helper to get a daemon client, exiting if daemon isn't running
 */
async function requireDaemon(port: number): Promise<InstanceType<typeof DaemonClient>> {
  const client = new DaemonClient({ port });
  if (!(await client.isRunning())) {
    console.error("Error: Daemon is not running. Start it with: reader start");
    process.exit(1);
  }
  return client;
}

const session = program
  .command("session")
  .description("Interactive browser session commands (requires daemon)");

session
  .command("create")
  .description("Create a new browser session")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("--viewport <WxH>", "Viewport size (e.g., 1920x1080)")
  .action(async (options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      let createOpts: any = {};
      if (options.viewport) {
        const [w, h] = options.viewport.split("x").map(Number);
        createOpts = { viewportWidth: w, viewportHeight: h };
      }
      const { sessionId } = await client.sessionCreate(createOpts);
      console.log(sessionId);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("close <id>")
  .description("Close a browser session")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionClose(id);
      console.log("Session closed");
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("list")
  .description("List active sessions")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const sessions = await client.sessionList();
      if (sessions.length === 0) {
        console.log("No active sessions");
      } else {
        for (const s of sessions) {
          const idle = Math.round((Date.now() - s.lastActivity) / 1000);
          console.log(`${s.id}  idle: ${idle}s`);
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("goto <id> <url>")
  .description("Navigate to a URL")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("-t, --timeout <ms>", "Navigation timeout", "30000")
  .action(async (id, url, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const result = await client.sessionGoto(id, url, parseInt(options.timeout, 10));
      console.log(result.title);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("back <id>")
  .description("Navigate back")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { url } = await client.sessionBack(id);
      console.log(url);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("forward <id>")
  .description("Navigate forward")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { url } = await client.sessionForward(id);
      console.log(url);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("reload <id>")
  .description("Reload the page")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionReload(id);
      console.log("Reloaded");
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("url <id>")
  .description("Get current URL")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { url } = await client.sessionUrl(id);
      console.log(url);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("snapshot <id>")
  .description("Take accessibility tree snapshot with @e refs")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("-i, --interactive", "Show interactive elements only")
  .option("-D, --diff", "Show diff against previous snapshot")
  .option("-s, --selector <sel>", "Scope to CSS selector")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { snapshot } = await client.sessionSnapshot(id, {
        interactive: options.interactive,
        diff: options.diff,
        selector: options.selector,
      });
      console.log(snapshot);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("click <id> <selector>")
  .description("Click an element (CSS selector or @e ref)")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionClick(id, selector);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("fill <id> <selector> <value>")
  .description("Fill an input (CSS selector or @e ref)")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, value, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionFill(id, selector, value);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("type <id> <text>")
  .description("Type text into focused element")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, text, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionType(id, text);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("press <id> <key>")
  .description("Press a key (Enter, Tab, Escape, etc.)")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, key, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionPress(id, key);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("hover <id> <selector>")
  .description("Hover over an element")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionHover(id, selector);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("select <id> <selector> <value>")
  .description("Select a dropdown option")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, value, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionSelect(id, selector, value);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("scroll <id> [selector]")
  .description("Scroll element into view or scroll to bottom")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionScroll(id, selector);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("upload <id> <selector> <file>")
  .description("Upload a file to an input")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, file, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionUpload(id, selector, [file]);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("screenshot <id>")
  .description("Take a screenshot")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .requiredOption("-o, --output <path>", "Output file path")
  .option("--annotate", "Overlay @e ref labels on elements")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { screenshot } = await client.sessionScreenshot(id, {
        path: options.output,
        annotate: options.annotate,
        format: options.output.endsWith(".jpg") || options.output.endsWith(".jpeg") ? "jpeg" : "png",
      });
      // Daemon returns base64; we need to save locally if daemon is remote
      // For local daemon, the session already saved to path
      // But write here too as a safety net
      const { writeFileSync: wf } = await import("fs");
      wf(options.output, Buffer.from(screenshot, "base64"));
      console.log(options.output);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("responsive <id>")
  .description("Take screenshots at mobile, tablet, and desktop viewports")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .requiredOption("-o, --output <prefix>", "Output file prefix")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { paths } = await client.sessionResponsive(id, options.output);
      for (const p of paths) {
        console.log(p);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("html <id> [selector]")
  .description("Get page HTML")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, selector, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { html } = await client.sessionHtml(id, selector);
      console.log(html);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("markdown <id>")
  .description("Get page as cleaned markdown")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { markdown } = await client.sessionMarkdown(id);
      console.log(markdown);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("text <id>")
  .description("Get page text content")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { text } = await client.sessionText(id);
      console.log(text);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("links <id>")
  .description("List all links on the page")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { links } = await client.sessionLinks(id);
      for (const link of links) {
        console.log(`${link.text} → ${link.href}`);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("is <id> <check> <selector>")
  .description("Check element state (visible, enabled, checked)")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, check, selector, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { result } = await client.sessionIs(id, check as any, selector);
      console.log(String(result));
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("console <id>")
  .description("Get console messages")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("--errors", "Show errors and warnings only")
  .option("--clear", "Clear buffer after reading")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { entries } = await client.sessionConsole(id, {
        errors: options.errors,
        clear: options.clear,
      });
      for (const entry of entries) {
        console.log(`[${entry.level}] ${entry.text}`);
      }
      if (entries.length === 0) {
        console.log("(no console messages)");
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("network <id>")
  .description("Get network requests")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("--errors", "Show 4xx/5xx responses only")
  .option("--clear", "Clear buffer after reading")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { entries } = await client.sessionNetwork(id, {
        errors: options.errors,
        clear: options.clear,
      });
      for (const entry of entries) {
        console.log(`${entry.status} ${entry.method} ${entry.url}`);
      }
      if (entries.length === 0) {
        console.log("(no network requests)");
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("dialog <id>")
  .description("Get dialog events")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .option("--clear", "Clear buffer after reading")
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { entries } = await client.sessionDialog(id, {
        clear: options.clear,
      });
      for (const entry of entries) {
        console.log(`[${entry.type}] ${entry.message}`);
      }
      if (entries.length === 0) {
        console.log("(no dialogs)");
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("dialog-accept <id> [text]")
  .description("Set dialog mode to auto-accept")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, text, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionDialogMode(id, "accept", text);
      console.log("Dialog mode: accept");
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("dialog-dismiss <id>")
  .description("Set dialog mode to auto-dismiss")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      await client.sessionDialogMode(id, "dismiss");
      console.log("Dialog mode: dismiss");
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("cookies <id>")
  .description("Get page cookies")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { cookies } = await client.sessionCookies(id);
      console.log(JSON.stringify(cookies, null, 2));
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("js <id> <expression>")
  .description("Evaluate JavaScript in page context")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, expression, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const { result } = await client.sessionJs(id, expression);
      console.log(result);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

session
  .command("viewport <id> <size>")
  .description("Set viewport size (e.g., 375x812)")
  .option("-p, --port <n>", `Daemon port`, String(DEFAULT_DAEMON_PORT))
  .action(async (id, size, options) => {
    const client = await requireDaemon(parseInt(options.port, 10));
    try {
      const [w, h] = size.split("x").map(Number);
      if (!w || !h) {
        console.error("Error: Size must be in WxH format (e.g., 375x812)");
        process.exit(1);
      }
      await client.sessionViewport(id, w, h);
      console.log(`Viewport set to ${w}x${h}`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// =============================================================================
// Parse and execute
// =============================================================================

program.parse();
