/**
 * Cloudflare challenge detection result
 */
export interface ChallengeDetection {
  /** Whether a challenge was detected */
  isChallenge: boolean;

  /** Type of challenge */
  type: "js_challenge" | "turnstile" | "captcha" | "blocked" | "none";

  /** Confidence level (0-100) */
  confidence: number;

  /** Detection signals found */
  signals: string[];
}

/**
 * Challenge resolution result
 */
export interface ChallengeResolutionResult {
  /** Whether the challenge was resolved */
  resolved: boolean;

  /** Method used to detect resolution */
  method: "url_redirect" | "signals_cleared" | "timeout";

  /** Time waited in milliseconds */
  waitedMs: number;
}

/**
 * Challenge waiting options
 */
export interface ChallengeWaitOptions {
  /** Maximum time to wait for resolution (default: 45000ms) */
  maxWaitMs?: number;

  /** How often to poll for resolution (default: 500ms) */
  pollIntervalMs?: number;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Initial URL before challenge */
  initialUrl: string;
}
