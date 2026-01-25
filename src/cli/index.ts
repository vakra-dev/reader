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
// Parse and execute
// =============================================================================

program.parse();
