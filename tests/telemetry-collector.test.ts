import { describe, it, expect } from 'vitest';
import {
  createTelemetryCollector,
  sanitizeTelemetryProperties,
} from '../src/lib/telemetry-collector.js';

describe('sanitizeTelemetryProperties', () => {
  it('keeps allowed properties with safe values', () => {
    const result = sanitizeTelemetryProperties({ route: '/ask', tier: 'free', garbage: 'x' });
    expect(result).toEqual({ route: '/ask', tier: 'free' });
  });

  it('rejects non-string/number/boolean values', () => {
    const result = sanitizeTelemetryProperties({ route: { nested: true } });
    expect(result).toEqual({});
  });

  it('rejects values with special characters', () => {
    const result = sanitizeTelemetryProperties({ route: '<script>alert(1)</script>' });
    expect(result).toEqual({});
  });

  it('truncates values over 80 chars', () => {
    const long = 'a'.repeat(100);
    const result = sanitizeTelemetryProperties({ route: long });
    expect(result.route.length).toBe(80);
  });
});

describe('TelemetryCollector', () => {
  it('records and serializes events', () => {
    const collector = createTelemetryCollector();
    collector.record('page_view', { route: '/' });
    collector.record('page_view', { route: '/ask' });
    const report = collector.serialize();
    expect(report.counters.page_view).toBe(2);
    expect(report.breakdowns.page_view.route['/']).toBe(1);
    expect(report.breakdowns.page_view.route['/ask']).toBe(1);
  });

  it('enforces allowed events', () => {
    const collector = createTelemetryCollector();
    expect(collector.isEventAllowed('page_view')).toBe(true);
    expect(collector.isEventAllowed('fake_event')).toBe(false);
  });

  it('rate-limits by key', () => {
    const collector = createTelemetryCollector({ limitPerMinute: 2 });
    expect(collector.checkRateLimit('key1').allowed).toBe(true);
    expect(collector.checkRateLimit('key1').allowed).toBe(true);
    expect(collector.checkRateLimit('key1').allowed).toBe(false);
    expect(collector.checkRateLimit('key2').allowed).toBe(true);
  });
});
