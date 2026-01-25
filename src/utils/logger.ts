import pino from "pino";

/**
 * Logger type
 */
export type Logger = ReturnType<typeof createLogger>;

/**
 * Check if pino-pretty is available
 */
function hasPinoPretty(): boolean {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a logger instance
 *
 * @param name - Logger name
 * @param level - Log level (default: from env or 'info')
 * @returns Pino logger instance
 */
export function createLogger(
  name: string = "reader",
  level: string = process.env.LOG_LEVEL || "info"
) {
  const usePretty =
    process.env.NODE_ENV !== "production" && hasPinoPretty();

  return pino({
    name,
    level,
    transport: usePretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger();
