import pino from "pino";

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
  return pino({
    name,
    level,
    transport:
      process.env.NODE_ENV !== "production"
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
