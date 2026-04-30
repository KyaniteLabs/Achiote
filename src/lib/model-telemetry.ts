export type TelemetrySource = 'local_canary' | 'local_profiler' | 'weak_cloud' | 'unknown';

export interface NormalizedTelemetryEvent {
  source: TelemetrySource;
  provider: string;
  model: string;
  mode: string;
  prompt: string;
  category?: string;
  status?: number | string;
  classification?: string;
  latencyMs?: number;
  passed?: boolean;
  providerFailure?: boolean;
  findings: string[];
  quality: string[];
  errors: unknown[];
  toolPath: string[];
  guardReason?: string;
  reasoningTracePreview?: string;
  textPreview?: string;
  artifactPath?: string;
}

export interface TelemetryPattern {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  count: number;
  models: string[];
  providers: string[];
  examples: TelemetryPatternExample[];
  engineeringMove: string;
}

export interface TelemetryPatternExample {
  model: string;
  provider: string;
  prompt: string;
  artifactPath?: string;
  signals: string[];
}

export interface TelemetryMiningOptions {
  latencyOutlierMs?: number;
}

export function normalizeLocalCanarySummary(summary: unknown, artifactPath?: string): NormalizedTelemetryEvent[] {
  const object = asRecord(summary);
  const model = stringField(object.model) ?? 'unknown-local-model';
  const baseUrl = stringField(object.baseUrl);
  const results = Array.isArray(object.results) ? object.results : [];

  return results.map((result) => {
    const row = asRecord(result);
    const findings = stringArray(row.findings);
    const text = stringField(row.preview) ?? '';
    const errors = unknownArray(row.errors);
    const providerFailure = booleanField(row.providerFailure)
      ?? findings.some((finding) => /provider|runtime|aborted|timeout/i.test(finding))
      ?? false;

    return {
      source: 'local_canary',
      provider: 'local',
      model,
      mode: 'achiote',
      prompt: stringField(row.id) ?? 'unknown_case',
      category: stringField(row.category),
      status: numberOrString(row.status),
      latencyMs: numberField(row.ms),
      passed: booleanField(row.passed),
      providerFailure,
      findings,
      quality: stringArray(row.quality),
      errors,
      toolPath: stringArray(row.tools),
      guardReason: normalizeGuardReason(row.guarded),
      textPreview: clip(text),
      reasoningTracePreview: extractReasoningTrace(text),
      artifactPath: artifactPath ?? baseUrl,
    } satisfies NormalizedTelemetryEvent;
  });
}

export function normalizeWeakCloudRow(row: unknown, artifactPath?: string): NormalizedTelemetryEvent {
  const object = asRecord(row);
  const text = stringField(object.text) ?? stringField(object.preview) ?? '';
  const findings = stringArray(object.findings);
  const quality = stringArray(object.quality);
  const errors = unknownArray(object.errors);
  const done = asRecord(object.done);
  const guardReason = normalizeGuardReason(object.guardReason)
    ?? normalizeGuardReason(object.guarded)
    ?? normalizeGuardReason(done.guarded);

  return {
    source: 'weak_cloud',
    provider: stringField(object.provider) ?? 'unknown-provider',
    model: stringField(object.model) ?? 'unknown-model',
    mode: stringField(object.mode) ?? 'unknown-mode',
    prompt: stringField(object.prompt) ?? stringField(object.id) ?? 'unknown_prompt',
    category: stringField(object.category),
    status: numberOrString(object.status),
    classification: stringField(object.classification),
    latencyMs: numberField(object.ms) ?? numberField(object.latencyMs),
    passed: booleanField(object.passed),
    providerFailure: booleanField(object.providerFailure) ?? inferProviderFailure(object, errors),
    findings,
    quality,
    errors,
    toolPath: stringArray(object.tools),
    guardReason,
    reasoningTracePreview: stringField(object.reasoningTracePreview) ?? extractReasoningTrace(text),
    textPreview: clip(text),
    artifactPath,
  };
}

export function normalizeLocalProfilerArtifact(artifact: unknown, artifactPath?: string): NormalizedTelemetryEvent[] {
  const object = asRecord(artifact);
  const model = stringField(object.model) ?? 'unknown-local-model';
  const profile = stringField(object.profile) ?? 'unknown-profile';
  const events = Array.isArray(object.events) ? object.events : [];

  return events.map((event) => {
    const row = asRecord(event);
    const result = asRecord(row.result);
    const response = asRecord(result.response);
    const usage = asRecord(response.usage);
    const text = stringField(result.textPreview)
      ?? stringField(asRecord(asRecord(Array.isArray(response.choices) ? response.choices[0] : undefined).message).content)
      ?? '';
    const error = row.error;
    const findings = [
      stringField(row.label),
      booleanField(row.ok) === false ? 'profiler_event_failed' : undefined,
      numberField(usage.reasoning_tokens) !== undefined ? 'reasoning_tokens_present' : undefined,
      extractReasoningTrace(text) ? 'reasoning_trace_exposed' : undefined,
      stringField(asRecord(Array.isArray(response.choices) ? response.choices[0] : undefined).finish_reason) === 'length' ? 'finish_reason:length' : undefined,
    ].filter((value): value is string => Boolean(value));

    return {
      source: 'local_profiler',
      provider: 'local',
      model,
      mode: `local-profile:${profile}`,
      prompt: stringField(row.label) ?? 'profiler_event',
      status: booleanField(row.ok) === false ? 'error' : 'ok',
      latencyMs: numberField(row.ms),
      passed: booleanField(row.ok),
      providerFailure: booleanField(row.ok) === false,
      findings,
      quality: [],
      errors: error === undefined ? [] : [error],
      toolPath: [],
      reasoningTracePreview: stringField(result.reasoningTracePreview) ?? extractReasoningTrace(text),
      textPreview: clip(text),
      artifactPath,
    } satisfies NormalizedTelemetryEvent;
  });
}

export function mineTelemetryPatterns(
  events: NormalizedTelemetryEvent[],
  options: TelemetryMiningOptions = {},
): TelemetryPattern[] {
  const latencyOutlierMs = options.latencyOutlierMs ?? 120_000;
  const specs: Array<Omit<TelemetryPattern, 'count' | 'models' | 'providers' | 'examples'> & {
    match: (event: NormalizedTelemetryEvent) => boolean;
    signals: (event: NormalizedTelemetryEvent) => string[];
  }> = [
    {
      id: 'tool_workflow_fragility',
      title: 'Tool workflow fragility',
      severity: 'high',
      engineeringMove: 'Move tool alias repair, required-step validation, and deterministic recovery into controller code before retrying the model.',
      match: hasToolWorkflowFragility,
      signals: eventSignals,
    },
    {
      id: 'fallback_quality_drift',
      title: 'Fallback quality drift',
      severity: 'medium',
      engineeringMove: 'Make fallback templates stricter about minimum viable cues and run quality validators on fallback text, not just model text.',
      match: hasFallbackQualityDrift,
      signals: eventSignals,
    },
    {
      id: 'provider_or_runtime_instability',
      title: 'Provider or runtime instability',
      severity: 'high',
      engineeringMove: 'Capture raw provider bodies, endpoint style, timeout class, and retry budget so compatibility problems are diagnosable instead of hand-waved.',
      match: hasProviderOrRuntimeInstability,
      signals: eventSignals,
    },
    {
      id: 'trust_boundary_pressure',
      title: 'Trust boundary pressure',
      severity: 'high',
      engineeringMove: 'Keep provider identity, browsing claims, credential-looking text, and live-price claims behind deterministic sanitizers and receipts.',
      match: hasTrustBoundaryPressure,
      signals: eventSignals,
    },
    {
      id: 'latency_outlier',
      title: 'Latency outlier',
      severity: 'medium',
      engineeringMove: 'Bucket cold-load, prompt, provider, and generation latency separately; profile local loads with explicit KV/cache/thread settings.',
      match: (event) => (event.latencyMs ?? 0) >= latencyOutlierMs,
      signals: (event) => [`${event.latencyMs ?? 0}ms >= ${latencyOutlierMs}ms`, ...eventSignals(event)],
    },
    {
      id: 'guard_dependency',
      title: 'Guard dependency',
      severity: 'medium',
      engineeringMove: 'Treat guard reasons as first-class outcome states and compare naked versus Achiote runs to measure how much the wrapper repaired.',
      match: (event) => Boolean(event.guardReason),
      signals: (event) => [event.guardReason ?? 'guarded', ...eventSignals(event)],
    },
    {
      id: 'reasoning_trace_exposure',
      title: 'Reasoning trace exposure',
      severity: 'medium',
      engineeringMove: 'Capture reasoning traces as diagnostic telemetry, but strip scratchpad-looking content from user-facing answers and score it separately from answer quality.',
      match: (event) => Boolean(event.reasoningTracePreview) || combinedSignals(event).includes('reasoning_tokens_present'),
      signals: (event) => ['reasoning trace captured', ...eventSignals(event)],
    },
  ];

  return specs
    .map((spec) => {
      const matches = events.filter(spec.match);
      return {
        id: spec.id,
        title: spec.title,
        severity: spec.severity,
        count: matches.length,
        models: uniqueSorted(matches.map((event) => event.model)),
        providers: uniqueSorted(matches.map((event) => event.provider)),
        examples: matches.slice(0, 5).map((event) => ({
          model: event.model,
          provider: event.provider,
          prompt: event.prompt,
          artifactPath: event.artifactPath,
          signals: uniqueSorted(spec.signals(event)).slice(0, 6),
        })),
        engineeringMove: spec.engineeringMove,
      } satisfies TelemetryPattern;
    })
    .filter((pattern) => pattern.count > 0)
    .sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return right.count - left.count;
    });
}

export function renderTelemetryMarkdown(input: {
  events: NormalizedTelemetryEvent[];
  patterns: TelemetryPattern[];
  generatedAt: string;
}): string {
  const lines = [
    '# Model Telemetry Report',
    '',
    `Generated: ${input.generatedAt}`,
    `Events: ${input.events.length}`,
    `Models: ${uniqueSorted(input.events.map((event) => event.model)).join(', ') || 'none'}`,
    '',
    '## Meta Patterns',
    '',
  ];

  for (const pattern of input.patterns) {
    lines.push(`### ${pattern.id}`);
    lines.push(`Severity: ${pattern.severity}`);
    lines.push(`Count: ${pattern.count}`);
    lines.push(`Models: ${pattern.models.join(', ')}`);
    lines.push(`Providers: ${pattern.providers.join(', ')}`);
    lines.push(`Engineering move: ${pattern.engineeringMove}`);
    lines.push('');
    for (const example of pattern.examples) {
      const artifact = example.artifactPath ? ` (${example.artifactPath})` : '';
      lines.push(`- ${example.model} via ${example.provider}, ${example.prompt}${artifact}: ${example.signals.join('; ')}`);
    }
    lines.push('');
  }

  lines.push('## Reasoning / Trace Signals');
  lines.push('');
  const traceEvents = input.events.filter((event) => event.reasoningTracePreview);
  if (traceEvents.length === 0) {
    lines.push('No reasoning traces captured in the normalized inputs.');
  } else {
    for (const event of traceEvents.slice(0, 20)) {
      lines.push(`- ${event.model} via ${event.provider}, ${event.prompt}: ${event.reasoningTracePreview}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function hasToolWorkflowFragility(event: NormalizedTelemetryEvent): boolean {
  const haystack = combinedSignals(event);
  return /tool_failed|missing_tool|unsupported tool|parse tool arguments|not_done:error|tool workflow/i.test(haystack);
}

function hasFallbackQualityDrift(event: NormalizedTelemetryEvent): boolean {
  const haystack = combinedSignals(event);
  return /full_recipe_drift|missing_expected_text_signal|empty_text|fallback quality|sweet-texture/i.test(haystack);
}

function hasProviderOrRuntimeInstability(event: NormalizedTelemetryEvent): boolean {
  const haystack = combinedSignals(event);
  return event.providerFailure === true
    || event.errors.length > 0
    || /provider_compatibility|provider_failed|provider returned error|runtime|transport|timeout|aborted/i.test(haystack);
}

function hasTrustBoundaryPressure(event: NormalizedTelemetryEvent): boolean {
  const haystack = combinedSignals(event);
  return /trust-boundary|false_browsing_claim|browse|browsing|live web|grocery prices|provider identity|api_key|credential/i.test(haystack);
}

function eventSignals(event: NormalizedTelemetryEvent): string[] {
  return [
    event.classification,
    event.guardReason,
    ...event.findings,
    ...event.quality,
    ...event.errors.map(stringifyUnknown),
  ].filter((value): value is string => Boolean(value));
}

function combinedSignals(event: NormalizedTelemetryEvent): string {
  return [
    event.provider,
    event.model,
    event.mode,
    event.prompt,
    event.category,
    event.classification,
    event.guardReason,
    event.textPreview,
    event.reasoningTracePreview,
    ...event.findings,
    ...event.quality,
    ...event.errors.map(stringifyUnknown),
  ].filter(Boolean).join('\n');
}

function extractReasoningTrace(text: string): string | undefined {
  const match = text.match(/(?:Thinking Process|Reasoning|Trace)\s*:\s*[\s\S]{0,500}/i);
  return match ? clip(match[0]) : undefined;
}

function clip(value: string, maxLength = 500): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normalizeGuardReason(value: unknown): string | undefined {
  const guard = stringField(value);
  return guard && guard.length > 0 ? guard : undefined;
}

function inferProviderFailure(object: Record<string, unknown>, errors: unknown[]): boolean {
  const classification = stringField(object.classification) ?? '';
  const status = numberOrString(object.status);
  if (errors.length > 0) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return /provider_compatibility|provider_failed|timeout|transport|runtime/i.test(classification);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrString(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function severityRank(severity: TelemetryPattern['severity']): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}
