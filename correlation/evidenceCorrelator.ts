import { redactLogMessage } from '../logs/logProvider';

export type EvidenceType = 'METRIC' | 'LOG' | 'TRACE';
export type TimelineDataSource = 'SIMULATED' | 'LIVE' | 'UNAVAILABLE';

export interface CorrelatableMetricObservation {
  name: string;
  label: string;
  value: number | null;
  unit: string;
  status: 'observed' | 'missing' | 'unavailable';
}

export interface CorrelatableMetricEvidence {
  available: boolean;
  service: string;
  timestamp: string;
  provider: 'mock' | 'prometheus';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  observations: CorrelatableMetricObservation[];
  missing_metrics: string[];
  unavailable_reason?: string;
}

export interface CorrelatableLogEntry {
  id: string;
  timestamp: string;
  service: string;
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  message: string;
  trace_id?: string;
  request_id?: string;
  data_source: 'SIMULATED' | 'LIVE';
}

export interface CorrelatableLogEvidence {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  logs: CorrelatableLogEntry[];
  unavailable_reason?: string;
}

export interface CorrelatableTraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  start_time: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  error_message?: string;
  data_source: 'SIMULATED' | 'LIVE';
}

export interface CorrelatableTraceItem {
  trace_id: string;
  root_service: string;
  root_operation: string;
  start_time: string;
  total_duration_ms: number;
  status: 'OK' | 'ERROR';
  has_error: boolean;
  has_slow_span: boolean;
  slow_threshold_ms: number;
  spans: CorrelatableTraceSpan[];
  slow_spans: CorrelatableTraceSpan[];
  failed_spans: CorrelatableTraceSpan[];
  data_source: 'SIMULATED' | 'LIVE';
}

export interface CorrelatableTraceEvidence {
  available: boolean;
  service: string;
  since?: string;
  timestamp: string;
  provider: 'mock' | 'http';
  data_source: 'SIMULATED' | 'LIVE';
  simulated: boolean;
  total: number;
  traces: CorrelatableTraceItem[];
  slow_spans_count: number;
  failed_spans_count: number;
  unavailable_reason?: string;
}

export interface CorrelatedTimelineEvent {
  id: string;
  timestamp: string;
  service: string;
  evidence_type: EvidenceType;
  observation: string;
  data_source: TimelineDataSource;
  signal_category: 'error' | 'latency' | 'resource' | 'info' | 'unavailable';
  trace_id?: string;
  request_id?: string;
  span_id?: string;
  correlation_group_id?: string;
}

export interface CorrelatedSignalGroup {
  group_id: string;
  correlation_key: string;
  service: string;
  trace_id?: string;
  request_id?: string;
  data_sources: TimelineDataSource[];
  evidence_types: EvidenceType[];
  event_count: number;
  has_errors: boolean;
  has_latency_spike: boolean;
  summary: string;
}

export interface CorrelationHypothesis {
  title: string;
  explanation: string;
  confidence: number;
  confidence_explanation: string;
  causation_disclaimer: string;
}

export interface EvidenceCorrelationResult {
  service: string;
  since: string;
  generated_at: string;
  source_provenance: {
    metrics: TimelineDataSource;
    logs: TimelineDataSource;
    traces: TimelineDataSource;
    mixed_sources: boolean;
  };
  timeline: CorrelatedTimelineEvent[];
  groups: CorrelatedSignalGroup[];
  detected_anomalies: {
    errors: string[];
    latency_spikes: string[];
    failed_spans: string[];
  };
  key_observations: string[];
  supporting_evidence_refs: string[];
  hypothesis: CorrelationHypothesis;
  missing_and_limitations: string[];
}

export interface CorrelationInput {
  service: string;
  since?: string;
  metrics_evidence?: CorrelatableMetricEvidence;
  logs_evidence?: CorrelatableLogEvidence;
  traces_evidence?: CorrelatableTraceEvidence;
}

const EVIDENCE_TYPE_ORDER: Record<EvidenceType, number> = {
  TRACE: 1,
  LOG: 2,
  METRIC: 3,
};

function safeTimeMs(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

export function correlateIncidentEvidence(input: CorrelationInput): EvidenceCorrelationResult {
  const service = input.service?.trim() || 'auth-gateway-prod';
  const since = input.since?.trim() || '30m';
  const generatedAt = new Date().toISOString();

  const me = input.metrics_evidence;
  const le = input.logs_evidence;
  const te = input.traces_evidence;

  const metricsSource: TimelineDataSource = !me || !me.available ? 'UNAVAILABLE' : me.data_source;
  const logsSource: TimelineDataSource = !le || !le.available ? 'UNAVAILABLE' : le.data_source;
  const tracesSource: TimelineDataSource = !te || !te.available ? 'UNAVAILABLE' : te.data_source;

  const activeSources = [metricsSource, logsSource, tracesSource].filter((s) => s !== 'UNAVAILABLE');
  const uniqueActiveSources = Array.from(new Set(activeSources));
  const mixedSources = uniqueActiveSources.length > 1;

  const timeline: CorrelatedTimelineEvent[] = [];
  const errors: string[] = [];
  const latencySpikes: string[] = [];
  const failedSpansSummary: string[] = [];
  const keyObservations: string[] = [];
  const supportingRefs = new Set<string>();
  const limitations: string[] = [];

  if (mixedSources) {
    limitations.push(
      `Mixed telemetry provenance detected (${[
        me ? `metrics=${metricsSource}` : null,
        le ? `logs=${logsSource}` : null,
        te ? `traces=${tracesSource}` : null,
      ]
        .filter(Boolean)
        .join(', ')}); each timeline entry preserves its individual source label.`
    );
  }

  let hasMetricAnomaly = false;
  let hasErrorLogs = false;
  let hasLatencyLogs = false;
  let hasTraceFailureOrSlow = false;

  // 1. Collect METRIC timeline entries & anomalies
  if (!me) {
    limitations.push('Metrics evidence was not supplied to the correlation engine.');
  } else if (!me.available) {
    const reason = me.unavailable_reason || 'Metrics provider unavailable';
    timeline.push({
      id: `corr-metric-unavail`,
      timestamp: me.timestamp,
      service: me.service,
      evidence_type: 'METRIC',
      observation: redactLogMessage(`Metrics retrieval failed (${me.provider}): ${reason}. Missing metrics were not invented.`),
      data_source: 'UNAVAILABLE',
      signal_category: 'unavailable',
    });
    limitations.push(`Metrics source (${me.provider}) unavailable: ${reason}`);
  } else {
    const observedMetrics = me.observations.filter((o) => o.status === 'observed' && o.value !== null);
    for (const obs of observedMetrics) {
      let category: CorrelatedTimelineEvent['signal_category'] = 'info';
      const val = obs.value as number;
      if (obs.name === 'http_error_rate_percent' && val >= 2.0) {
        category = 'error';
        hasMetricAnomaly = true;
        errors.push(`Metric ${obs.name}=${val}${obs.unit} on ${me.service} [${me.data_source}]`);
      } else if (obs.name === 'api_latency_p95_ms' && val >= 500) {
        category = 'latency';
        hasMetricAnomaly = true;
        latencySpikes.push(`Metric ${obs.name}=${val}${obs.unit} on ${me.service} [${me.data_source}]`);
      } else if ((obs.name === 'cpu_usage_percent' || obs.name === 'memory_usage_percent') && val >= 80) {
        category = 'resource';
        hasMetricAnomaly = true;
      }

      supportingRefs.add(`metric:${obs.name}@${me.timestamp}`);
      timeline.push({
        id: `corr-metric-${obs.name}`,
        timestamp: me.timestamp,
        service: me.service,
        evidence_type: 'METRIC',
        observation: `${obs.label} (${obs.name}) = ${val}${obs.unit}`,
        data_source: me.data_source,
        signal_category: category,
      });
    }

    if (observedMetrics.length > 0) {
      const metricSummary = observedMetrics.map((o) => `${o.name}=${o.value}${o.unit}`).join(', ');
      keyObservations.push(`[METRIC • ${me.data_source}] ${me.service} @ ${me.timestamp}: ${metricSummary}`);
    }

    if (me.missing_metrics.length > 0) {
      limitations.push(
        `Metrics missing from ${me.provider} (${me.data_source}): ${me.missing_metrics.join(', ')} — not invented.`
      );
    }
  }

  // 2. Collect LOG timeline entries & anomalies
  if (!le) {
    limitations.push('Structured log evidence was not supplied to the correlation engine.');
  } else if (!le.available) {
    const reason = le.unavailable_reason || 'Log provider unavailable';
    timeline.push({
      id: `corr-log-unavail`,
      timestamp: le.timestamp,
      service: le.service,
      evidence_type: 'LOG',
      observation: redactLogMessage(`Log retrieval failed (${le.provider}): ${reason}. Missing logs were not invented.`),
      data_source: 'UNAVAILABLE',
      signal_category: 'unavailable',
    });
    limitations.push(`Log source (${le.provider}) unavailable: ${reason}`);
  } else if (le.logs.length === 0) {
    limitations.push(`No structured log events observed for "${le.service}" within window "${le.since || since}" — not invented.`);
  } else {
    for (const entry of le.logs) {
      const redactedMsg = redactLogMessage(entry.message);
      const lowerMsg = redactedMsg.toLowerCase();
      let category: CorrelatedTimelineEvent['signal_category'] = 'info';

      if (entry.severity === 'FATAL' || entry.severity === 'ERROR') {
        category = 'error';
        hasErrorLogs = true;
        errors.push(`[${entry.severity}] ${entry.service}: ${redactedMsg}`);
      } else if (entry.severity === 'WARN' && (lowerMsg.includes('latency') || lowerMsg.includes('slow') || lowerMsg.includes('timeout'))) {
        category = 'latency';
        hasLatencyLogs = true;
        latencySpikes.push(`[${entry.severity}] ${entry.service}: ${redactedMsg}`);
      }

      supportingRefs.add(`log:${entry.id}${entry.trace_id ? `(${entry.trace_id})` : ''}`);
      timeline.push({
        id: `corr-log-${entry.id}`,
        timestamp: entry.timestamp,
        service: entry.service,
        evidence_type: 'LOG',
        observation: `[${entry.severity}] ${redactedMsg}`,
        data_source: entry.data_source,
        signal_category: category,
        ...(entry.trace_id ? { trace_id: entry.trace_id } : {}),
        ...(entry.request_id ? { request_id: entry.request_id } : {}),
      });
    }

    const topLog = le.logs[0];
    keyObservations.push(
      `[LOG • ${le.data_source}] ${le.logs.length} event(s) for ${le.service}; highest severity ${topLog.severity} @ ${topLog.timestamp}: ${redactLogMessage(topLog.message)}`
    );
  }

  // 3. Collect TRACE timeline entries & anomalies
  if (!te) {
    limitations.push('Distributed trace evidence was not supplied to the correlation engine.');
  } else if (!te.available) {
    const reason = te.unavailable_reason || 'Trace provider unavailable';
    timeline.push({
      id: `corr-trace-unavail`,
      timestamp: te.timestamp,
      service: te.service,
      evidence_type: 'TRACE',
      observation: redactLogMessage(`Trace retrieval failed (${te.provider}): ${reason}. Missing spans were not invented.`),
      data_source: 'UNAVAILABLE',
      signal_category: 'unavailable',
    });
    limitations.push(`Trace source (${te.provider}) unavailable: ${reason}`);
  } else if (te.traces.length === 0) {
    limitations.push(`No distributed traces observed for "${te.service}" within window "${te.since || since}" — not invented.`);
  } else {
    for (const tr of te.traces) {
      supportingRefs.add(`trace:${tr.trace_id}`);
      for (const sp of tr.spans) {
        const isSlow = sp.duration_ms >= tr.slow_threshold_ms;
        const isError = sp.status === 'ERROR';
        if (isError) {
          hasTraceFailureOrSlow = true;
          failedSpansSummary.push(
            `${tr.trace_id}/${sp.span_id} ${sp.service_name}:${sp.operation_name} (${sp.duration_ms}ms, ERROR)`
          );
        }
        if (isSlow) {
          hasTraceFailureOrSlow = true;
          latencySpikes.push(
            `Span ${sp.service_name}:${sp.operation_name} took ${sp.duration_ms}ms (>=${tr.slow_threshold_ms}ms) [${sp.data_source}]`
          );
        }

        const category: CorrelatedTimelineEvent['signal_category'] = isError
          ? 'error'
          : isSlow
          ? 'latency'
          : 'info';

        const parentLabel = sp.parent_span_id ? `parent=${sp.parent_span_id}` : 'root';
        const errSuffix = sp.error_message ? ` — ${redactLogMessage(sp.error_message)}` : '';

        timeline.push({
          id: `corr-span-${tr.trace_id}-${sp.span_id}`,
          timestamp: sp.start_time,
          service: sp.service_name,
          evidence_type: 'TRACE',
          observation: `${sp.operation_name} (${sp.duration_ms}ms, ${sp.status}, ${parentLabel})${errSuffix}`,
          data_source: sp.data_source,
          signal_category: category,
          trace_id: sp.trace_id,
          span_id: sp.span_id,
        });
      }
    }

    const primaryTrace = te.traces[0];
    keyObservations.push(
      `[TRACE • ${te.data_source}] ${te.traces.length} trace(s) inspected; primary ${primaryTrace.trace_id} (${primaryTrace.total_duration_ms}ms, ${primaryTrace.status}) path: ${primaryTrace.spans.map((s) => s.service_name).join(' -> ')}`
    );
  }

  // 4. Sort unified timeline chronologically ascending
  timeline.sort((a, b) => {
    const diff = safeTimeMs(a.timestamp) - safeTimeMs(b.timestamp);
    if (diff !== 0) return diff;
    const typeDiff = EVIDENCE_TYPE_ORDER[a.evidence_type] - EVIDENCE_TYPE_ORDER[b.evidence_type];
    if (typeDiff !== 0) return typeDiff;
    return a.id.localeCompare(b.id);
  });

  // 5. Group related signals by trace_id / request_id / service window
  const groupBuckets = new Map<
    string,
    {
      correlationKey: string;
      service: string;
      traceId?: string;
      requestId?: string;
      events: CorrelatedTimelineEvent[];
    }
  >();

  for (const ev of timeline) {
    let key: string;
    if (ev.trace_id) {
      key = `trace:${ev.trace_id}`;
    } else if (ev.request_id) {
      key = `request:${ev.request_id}`;
    } else {
      key = `service:${ev.service}@${since}`;
    }

    let bucket = groupBuckets.get(key);
    if (!bucket) {
      bucket = {
        correlationKey: key,
        service: ev.service,
        ...(ev.trace_id ? { traceId: ev.trace_id } : {}),
        ...(ev.request_id ? { requestId: ev.request_id } : {}),
        events: [],
      };
      groupBuckets.set(key, bucket);
    }
    bucket.events.push(ev);
    if (!bucket.requestId && ev.request_id) bucket.requestId = ev.request_id;
  }

  let groupIndex = 1;
  const groups: CorrelatedSignalGroup[] = [];
  for (const bucket of groupBuckets.values()) {
    const groupId = `grp-${groupIndex++}`;
    for (const ev of bucket.events) {
      ev.correlation_group_id = groupId;
    }

    const dataSources = Array.from(new Set(bucket.events.map((e) => e.data_source)));
    const evidenceTypes = Array.from(new Set(bucket.events.map((e) => e.evidence_type)));
    const hasErrors = bucket.events.some((e) => e.signal_category === 'error');
    const hasLatencySpike = bucket.events.some((e) => e.signal_category === 'latency');

    groups.push({
      group_id: groupId,
      correlation_key: bucket.correlationKey,
      service: bucket.service,
      ...(bucket.traceId ? { trace_id: bucket.traceId } : {}),
      ...(bucket.requestId ? { request_id: bucket.requestId } : {}),
      data_sources: dataSources,
      evidence_types: evidenceTypes,
      event_count: bucket.events.length,
      has_errors: hasErrors,
      has_latency_spike: hasLatencySpike,
      summary: `${bucket.correlationKey}: ${bucket.events.length} event(s) across [${evidenceTypes.join(', ')}] (${dataSources.join(', ')})`,
    });
  }

  // 6. Compute bounded, transparent confidence & separate probable root-cause hypothesis
  const availableSignalTypes = [
    me?.available ? 'metrics' : null,
    le?.available && le.logs.length > 0 ? 'logs' : null,
    te?.available && te.traces.length > 0 ? 'traces' : null,
  ].filter(Boolean) as string[];

  const sharedTraceLink = groups.some((g) => Boolean(g.trace_id) && g.evidence_types.length >= 2);
  let confidence = 42;
  const confidenceFactors: string[] = [];

  if (hasMetricAnomaly) {
    confidence += 16;
    confidenceFactors.push('+16% from correlated metric threshold breaches');
  } else if (me?.available) {
    confidence += 6;
    confidenceFactors.push('+6% from nominal/partial metric baseline');
  }

  if (hasErrorLogs || hasLatencyLogs) {
    confidence += 18;
    confidenceFactors.push('+18% from ERROR/FATAL or latency warning log events');
  }

  if (hasTraceFailureOrSlow) {
    confidence += 18;
    confidenceFactors.push('+18% from slow/failed distributed trace spans');
  }

  if (sharedTraceLink) {
    confidence += 8;
    confidenceFactors.push('+8% from direct trace_id link across log & trace signals');
  }

  const unavailableCount = [metricsSource, logsSource, tracesSource].filter((s) => s === 'UNAVAILABLE').length;
  if (unavailableCount > 0) {
    const penalty = unavailableCount * 12;
    confidence -= penalty;
    confidenceFactors.push(`-${penalty}% due to ${unavailableCount} unavailable telemetry source(s)`);
  }

  confidence = Math.max(20, Math.min(95, Math.round(confidence * 10) / 10));

  limitations.push('Temporal and service correlation across telemetry streams does not independently prove causation.');

  const primaryFailedSpan = failedSpansSummary[0];
  const hypothesisTitle =
    hasTraceFailureOrSlow || hasErrorLogs || hasMetricAnomaly
      ? `Cross-Signal Strain & Downstream Contention on ${service}`
      : `Insufficient Correlated Anomaly Signal on ${service}`;

  const hypothesisExplanation =
    availableSignalTypes.length === 0
      ? `No live or simulated telemetry sources succeeded for ${service}; no root cause can be inferred without available evidence.`
      : `Correlating ${availableSignalTypes.join(', ')} telemetry for ${service} (window=${since}) surfaced ${errors.length} error indicator(s), ${latencySpikes.length} latency indicator(s), and ${failedSpansSummary.length} failed span(s)${
          primaryFailedSpan ? ` (notably ${primaryFailedSpan})` : ''
        }. This evidence supports a hypothesis of downstream dependency or connection-pool contention, pending commander verification.`;

  return {
    service,
    since,
    generated_at: generatedAt,
    source_provenance: {
      metrics: metricsSource,
      logs: logsSource,
      traces: tracesSource,
      mixed_sources: mixedSources,
    },
    timeline,
    groups,
    detected_anomalies: {
      errors: errors.slice(0, 12),
      latency_spikes: latencySpikes.slice(0, 12),
      failed_spans: failedSpansSummary.slice(0, 12),
    },
    key_observations: keyObservations,
    supporting_evidence_refs: Array.from(supportingRefs),
    hypothesis: {
      title: hypothesisTitle,
      explanation: hypothesisExplanation,
      confidence,
      confidence_explanation:
        confidenceFactors.length > 0
          ? `Confidence ${confidence}% derived from: ${confidenceFactors.join('; ')}.`
          : `Confidence ${confidence}% (minimal baseline evidence available).`,
      causation_disclaimer:
        'Correlation across metrics, logs, and traces identifies temporal/structural alignment only and does not constitute proof of causation.',
    },
    missing_and_limitations: limitations,
  };
}
