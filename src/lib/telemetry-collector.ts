/**
 * TelemetryCollector — extracted from http-server.ts
 *
 * Self-contained module for recording, sanitizing, rate-limiting, and
 * serializing telemetry events.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_EVENTS = new Set([
  'page_view',
  'pricing_viewed',
  'app_opened',
  'onboarding_prompt_selected',
  'ask_started',
  'ask_succeeded',
  'ask_failed',
  'checkout_started',
  'checkout_failed',
  'feedback_close',
  'feedback_closer',
  'feedback_wrong_region',
  'feedback_wrong_acid',
  'feedback_wrong_texture',
  'feedback_too_generic',
  'feedback_too_hard',
  'feedback_missed_correction',
  'feedback_missed_name_correction',
  'receipt_downloaded',
  'receipt_share_copied',
  'family_questions_copied',
  'waitlist_submitted',
]);

const ALLOWED_PROPERTIES = new Set([
  'route',
  'source',
  'category',
  'tier',
  'mode',
  'billing',
  'reason',
  'hasHistory',
  'emailDomain',
]);

const MAX_VALUES_PER_PROPERTY = 25;
const OTHER_VALUE = 'other';
const RATE_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryCollectorOptions {
  /** Max telemetry requests per key per minute. Defaults to 120. */
  limitPerMinute?: number;
}

export interface TelemetryCollector {
  isEventAllowed(eventName: string): boolean;
  record(eventName: string, properties: Record<string, string>): void;
  checkRateLimit(key: string): { allowed: boolean; remaining: number; limit: number; resetAt: number };
  serialize(): {
    counters: Record<string, number>;
    breakdowns: Record<string, Record<string, Record<string, number>>>;
  };
}

// ---------------------------------------------------------------------------
// Standalone sanitization function
// ---------------------------------------------------------------------------

export function sanitizeTelemetryProperties(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_PROPERTIES.has(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    const normalized = String(value).trim().slice(0, 80);
    if (!/^[a-zA-Z0-9_./:-]+$/.test(normalized)) continue;
    sanitized[key] = normalized;
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTelemetryCollector(options?: TelemetryCollectorOptions): TelemetryCollector {
  const limitPerMinute = options?.limitPerMinute ?? 120;
  const limit = Math.max(1, limitPerMinute);

  const counters = new Map<string, number>();
  const breakdowns = new Map<string, Map<string, Map<string, number>>>();
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function isEventAllowed(eventName: string): boolean {
    return ALLOWED_EVENTS.has(eventName);
  }

  function record(eventName: string, properties: Record<string, string>): void {
    counters.set(eventName, (counters.get(eventName) ?? 0) + 1);

    if (!breakdowns.has(eventName)) breakdowns.set(eventName, new Map());
    const eventBreakdown = breakdowns.get(eventName)!;
    for (const [property, value] of Object.entries(properties)) {
      if (!eventBreakdown.has(property)) eventBreakdown.set(property, new Map());
      const values = eventBreakdown.get(property)!;
      const bucket = values.has(value) || values.size < MAX_VALUES_PER_PROPERTY - 1
        ? value
        : OTHER_VALUE;
      values.set(bucket, (values.get(bucket) ?? 0) + 1);
    }
  }

  function checkRateLimit(key: string): { allowed: boolean; remaining: number; limit: number; resetAt: number } {
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, limit, resetAt: bucket.resetAt };
    }

    bucket.count++;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), limit, resetAt: bucket.resetAt };
  }

  function serialize(): {
    counters: Record<string, number>;
    breakdowns: Record<string, Record<string, Record<string, number>>>;
  } {
    const serializedBreakdowns: Record<string, Record<string, Record<string, number>>> = {};
    for (const [eventName, properties] of breakdowns.entries()) {
      serializedBreakdowns[eventName] = {};
      for (const [property, values] of properties.entries()) {
        serializedBreakdowns[eventName][property] = Object.fromEntries(values);
      }
    }
    return {
      counters: Object.fromEntries(counters),
      breakdowns: serializedBreakdowns,
    };
  }

  return { isEventAllowed, record, checkRateLimit, serialize };
}
