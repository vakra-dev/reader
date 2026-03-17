/**
 * Daemon Session Types
 *
 * Request/response types for session management via the daemon HTTP API.
 */

import type {
  SnapshotOptions,
  ScreenshotOptions,
  SessionCreateOptions,
} from "../browser/types.js";

// =============================================================================
// Session request types
// =============================================================================

export interface SessionCreateRequest {
  action: "session.create";
  options?: SessionCreateOptions;
}

export interface SessionCloseRequest {
  action: "session.close";
  sessionId: string;
}

export interface SessionListRequest {
  action: "session.list";
}

export interface SessionGotoRequest {
  action: "session.goto";
  sessionId: string;
  url: string;
  timeoutMs?: number;
}

export interface SessionBackRequest {
  action: "session.back";
  sessionId: string;
}

export interface SessionForwardRequest {
  action: "session.forward";
  sessionId: string;
}

export interface SessionReloadRequest {
  action: "session.reload";
  sessionId: string;
}

export interface SessionUrlRequest {
  action: "session.url";
  sessionId: string;
}

export interface SessionSnapshotRequest {
  action: "session.snapshot";
  sessionId: string;
  options?: SnapshotOptions;
}

export interface SessionClickRequest {
  action: "session.click";
  sessionId: string;
  selectorOrRef: string;
}

export interface SessionFillRequest {
  action: "session.fill";
  sessionId: string;
  selectorOrRef: string;
  value: string;
}

export interface SessionTypeRequest {
  action: "session.type";
  sessionId: string;
  text: string;
}

export interface SessionPressRequest {
  action: "session.press";
  sessionId: string;
  key: string;
}

export interface SessionHoverRequest {
  action: "session.hover";
  sessionId: string;
  selectorOrRef: string;
}

export interface SessionSelectRequest {
  action: "session.select";
  sessionId: string;
  selectorOrRef: string;
  value: string;
}

export interface SessionScrollRequest {
  action: "session.scroll";
  sessionId: string;
  selectorOrRef?: string;
}

export interface SessionUploadRequest {
  action: "session.upload";
  sessionId: string;
  selectorOrRef: string;
  filePaths: string[];
}

export interface SessionScreenshotRequest {
  action: "session.screenshot";
  sessionId: string;
  options?: ScreenshotOptions;
}

export interface SessionResponsiveRequest {
  action: "session.responsive";
  sessionId: string;
  outputPrefix: string;
}

export interface SessionHtmlRequest {
  action: "session.html";
  sessionId: string;
  selector?: string;
}

export interface SessionMarkdownRequest {
  action: "session.markdown";
  sessionId: string;
}

export interface SessionTextRequest {
  action: "session.text";
  sessionId: string;
}

export interface SessionLinksRequest {
  action: "session.links";
  sessionId: string;
}

export interface SessionIsRequest {
  action: "session.is";
  sessionId: string;
  check: "visible" | "enabled" | "checked";
  selectorOrRef: string;
}

export interface SessionConsoleRequest {
  action: "session.console";
  sessionId: string;
  errors?: boolean;
  clear?: boolean;
}

export interface SessionNetworkRequest {
  action: "session.network";
  sessionId: string;
  errors?: boolean;
  clear?: boolean;
}

export interface SessionDialogRequest {
  action: "session.dialog";
  sessionId: string;
  clear?: boolean;
}

export interface SessionDialogModeRequest {
  action: "session.dialog-mode";
  sessionId: string;
  mode: "accept" | "dismiss";
  promptText?: string;
}

export interface SessionCookiesRequest {
  action: "session.cookies";
  sessionId: string;
}

export interface SessionJsRequest {
  action: "session.js";
  sessionId: string;
  expression: string;
}

export interface SessionViewportRequest {
  action: "session.viewport";
  sessionId: string;
  width: number;
  height: number;
}

export interface SessionQueryRequest {
  action: "session.query";
  sessionId: string;
  selector: string;
}

export type SessionRequest =
  | SessionCreateRequest
  | SessionCloseRequest
  | SessionListRequest
  | SessionGotoRequest
  | SessionBackRequest
  | SessionForwardRequest
  | SessionReloadRequest
  | SessionUrlRequest
  | SessionSnapshotRequest
  | SessionClickRequest
  | SessionFillRequest
  | SessionTypeRequest
  | SessionPressRequest
  | SessionHoverRequest
  | SessionSelectRequest
  | SessionScrollRequest
  | SessionUploadRequest
  | SessionScreenshotRequest
  | SessionResponsiveRequest
  | SessionHtmlRequest
  | SessionMarkdownRequest
  | SessionTextRequest
  | SessionLinksRequest
  | SessionIsRequest
  | SessionConsoleRequest
  | SessionNetworkRequest
  | SessionDialogRequest
  | SessionDialogModeRequest
  | SessionCookiesRequest
  | SessionJsRequest
  | SessionViewportRequest
  | SessionQueryRequest;

// =============================================================================
// Session response types
// =============================================================================

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastActivity: number;
  closed: boolean;
}
