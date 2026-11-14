import { AiHypothesis } from '../types/incident';

export interface ProposedCommandAssessment {
  command: string;
  hasDryRunFlag: boolean;
  isPatchCommand: boolean;
  hasPatchPayload: boolean;
  isExecutableDryRun: boolean;
  copyDisabled: boolean;
  copyDisabledReason: string | null;
  missingRequirements: string[];
}

export interface RemediationEvidenceReason {
  signal: string;
  provenance: 'LIVE' | 'SIMULATED' | 'UNAVAILABLE';
  detail: string;
}

export interface WhyThisRemediationSummary {
  evidenceStatusLabel: string;
  hasObservedTelemetry: boolean;
  reasons: RemediationEvidenceReason[];
  safetyCaveat: string;
}

export interface ProposedConfigChangeAnalysis {
  parameter: string;
  currentValue: string;
  proposedValue: string;
  expectedImpact: string;
  potentialRisks: string;
  evidenceGrounding: string;
}

/**
 * Inspects a proposed remediation CLI command for display purposes only.
 * Never executes commands; identifies whether a command lacks a valid
 * --dry-run flag or required patch payload so incomplete proposals are
 * never presented as executable dry-runs and cannot be copied as ready commands.
 */
export function inspectProposedCommand(rawCommand: string | undefined | null): ProposedCommandAssessment {
  const command = (rawCommand ?? '').trim();

  if (!command) {
    const missingRequirements = ['No proposed command provided'];
    return {
      command: '',
      hasDryRunFlag: false,
      isPatchCommand: false,
      hasPatchPayload: false,
      isExecutableDryRun: false,
      copyDisabled: true,
      copyDisabledReason: 'Copy disabled: no proposed command is available.',
      missingRequirements,
    };
  }

  const hasDryRunFlag = /(?:^|\s)--dry-run=(?:client|server)(?=\s|$)|(?:^|\s)--dry-run(?=\s|$)/i.test(command);
  const isPatchCommand = /\bpatch\b/i.test(command);
  const hasPatchPayload = /(?:^|\s)(?:-p(?:\s+|=)\S|--patch(?:\s+|=)\S|--patch-file(?:\s+|=)\S)/i.test(command);

  const missingRequirements: string[] = [];
  if (!hasDryRunFlag) {
    missingRequirements.push('Missing valid --dry-run flag (e.g. --dry-run=client)');
  }
  if (isPatchCommand && !hasPatchPayload) {
    missingRequirements.push('Missing required patch payload (-p, --patch, or --patch-file)');
  }

  const isExecutableDryRun = missingRequirements.length === 0;

  return {
    command,
    hasDryRunFlag,
    isPatchCommand,
    hasPatchPayload,
    isExecutableDryRun,
    copyDisabled: !isExecutableDryRun,
    copyDisabledReason: isExecutableDryRun
      ? null
      : `Copy disabled: incomplete command (${missingRequirements.join('; ')}).`,
    missingRequirements,
  };
}

/**
 * Builds a strict evidence-grounded "Why this remediation?" explanation from
 * whatever telemetry and correlation signals actually exist on the hypothesis.
 * Never invents metrics, logs, spans, or safety claims without evidence.
 */
export function buildWhyThisRemediation(hypothesis: AiHypothesis): WhyThisRemediationSummary {
  const reasons: RemediationEvidenceReason[] = [];
  const seenProvenance = new Set<'LIVE' | 'SIMULATED' | 'UNAVAILABLE'>();

  const spanEv = hypothesis.telemetrySpanEvidence;
  const metricsEv = hypothesis.metricsEvidence;
  const logsEv = hypothesis.logsEvidence;
  const tracesEv = hypothesis.tracesEvidence;
  const corr = hypothesis.correlation;

  const fallbackProvenance: 'LIVE' | 'SIMULATED' =
    tracesEv?.available
      ? tracesEv.data_source
      : metricsEv?.available
      ? metricsEv.data_source
      : logsEv?.available
      ? logsEv.data_source
      : 'SIMULATED';

  if (spanEv && spanEv.spanName && spanEv.traceId) {
    const prov = tracesEv?.available ? tracesEv.data_source : fallbackProvenance;
    seenProvenance.add(prov);
    reasons.push({
      signal: 'TRACE SPAN',
      provenance: prov,
      detail: `Observed ${spanEv.spanName} on ${spanEv.culpritResource || 'target dependency'} taking ${spanEv.durationMs}ms vs ${spanEv.normalBaselineMs}ms baseline (trace ${spanEv.traceId}).`,
    });
  }

  if (metricsEv) {
    if (metricsEv.available) {
      seenProvenance.add(metricsEv.data_source);
      const observed = metricsEv.observations.filter(
        (obs) => obs.status === 'observed' && obs.value !== null
      );
      if (observed.length > 0) {
        const metricSummary = observed
          .slice(0, 4)
          .map((obs) => `${obs.label}: ${obs.value}${obs.unit}`)
          .join(', ');
        const missingNote =
          metricsEv.missing_metrics.length > 0
            ? ` Missing unverified series: ${metricsEv.missing_metrics.join(', ')}.`
            : '';
        reasons.push({
          signal: 'METRICS',
          provenance: metricsEv.data_source,
          detail: `Observed on ${metricsEv.service}: ${metricSummary}.${missingNote}`,
        });
      } else {
        reasons.push({
          signal: 'METRICS',
          provenance: 'UNAVAILABLE',
          detail: `Metrics provider (${metricsEv.provider}) returned no observed values for ${metricsEv.service}.`,
        });
        seenProvenance.add('UNAVAILABLE');
      }
    } else {
      seenProvenance.add('UNAVAILABLE');
      reasons.push({
        signal: 'METRICS',
        provenance: 'UNAVAILABLE',
        detail: `Metrics unavailable (${metricsEv.unavailable_reason || 'provider error'}); latency and saturation thresholds cannot be verified from live counters.`,
      });
    }
  }

  if (logsEv) {
    if (logsEv.available) {
      seenProvenance.add(logsEv.data_source);
      const priorityLog =
        logsEv.logs.find((l) => l.severity === 'FATAL' || l.severity === 'ERROR') ||
        logsEv.logs.find((l) => l.severity === 'WARN') ||
        logsEv.logs[0];
      if (priorityLog) {
        reasons.push({
          signal: 'LOGS',
          provenance: logsEv.data_source,
          detail: `[${priorityLog.severity}] ${priorityLog.service}: ${priorityLog.message}`,
        });
      } else {
        reasons.push({
          signal: 'LOGS',
          provenance: logsEv.data_source,
          detail: `No error or warning log lines observed for ${logsEv.service} in the ${logsEv.since || '30m'} window.`,
        });
      }
    } else {
      seenProvenance.add('UNAVAILABLE');
      reasons.push({
        signal: 'LOGS',
        provenance: 'UNAVAILABLE',
        detail: `Log source unavailable (${logsEv.unavailable_reason || 'provider error'}); error messages were not invented.`,
      });
    }
  }

  if (tracesEv) {
    if (tracesEv.available) {
      seenProvenance.add(tracesEv.data_source);
      reasons.push({
        signal: 'TRACES',
        provenance: tracesEv.data_source,
        detail: `${tracesEv.traces.length} distributed trace(s) inspected for ${tracesEv.service}: ${tracesEv.slow_spans_count} slow span(s) and ${tracesEv.failed_spans_count} failed span(s).`,
      });
    } else {
      seenProvenance.add('UNAVAILABLE');
      reasons.push({
        signal: 'TRACES',
        provenance: 'UNAVAILABLE',
        detail: `Distributed traces unavailable (${tracesEv.unavailable_reason || 'provider error'}); span bottlenecks remain unconfirmed.`,
      });
    }
  }

  if (corr && corr.key_observations.length > 0) {
    const corrProv: 'LIVE' | 'SIMULATED' | 'UNAVAILABLE' = corr.source_provenance.mixed_sources
      ? 'SIMULATED'
      : corr.source_provenance.traces !== 'UNAVAILABLE'
      ? corr.source_provenance.traces
      : corr.source_provenance.metrics;
    reasons.push({
      signal: 'CORRELATION',
      provenance: corrProv,
      detail: corr.key_observations[0],
    });
  }

  const hasLive = seenProvenance.has('LIVE');
  const hasSim = seenProvenance.has('SIMULATED');
  const hasUnavail = seenProvenance.has('UNAVAILABLE');
  const hasMissingMetrics = (metricsEv?.missing_metrics?.length ?? 0) > 0;

  const evidenceStatusLabel =
    hasUnavail || !reasons.length
      ? 'PARTIAL / UNAVAILABLE EVIDENCE'
      : hasLive && hasSim
      ? 'MIXED LIVE + SIMULATED EVIDENCE'
      : hasLive
      ? 'LIVE EVIDENCE'
      : 'SIMULATED EVIDENCE';

  const safetyCaveat =
    hasUnavail || hasMissingMetrics
      ? 'Evidence is incomplete or unavailable for at least one signal. This does not confirm the change is safe—verify live service headroom and rollback criteria before applying.'
      : hasLive
      ? 'Observed telemetry explains why this subsystem is targeted, not a safety guarantee. Verify downstream database capacity and blast radius before approving.'
      : 'Supporting evidence is from SIMULATED telemetry only. Production safety is not verified; human commander review and simulation-only execution remain enforced.';

  return {
    evidenceStatusLabel,
    hasObservedTelemetry: hasLive || hasSim,
    reasons,
    safetyCaveat,
  };
}

function parseConfigEntries(configText: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = (configText || '').split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Kubernetes container env pattern:
    // - name: DB_POOL_MAX_SIZE
    //   value: "20"
    const envNameMatch = trimmed.match(/^-\s*name:\s*(.+)$/);
    if (envNameMatch) {
      const paramName = envNameMatch[1].trim().replace(/^["']|["']$/g, '');
      const nextLine = (lines[i + 1] || '').trim();
      const valueMatch = nextLine.match(/^value:\s*(.+)$/);
      if (valueMatch) {
        entries.set(paramName, valueMatch[1].trim());
        i++;
        continue;
      }
    }

    // Properties / YAML key: value or key=value pattern (skip structural YAML headings ending in ':')
    const kvMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?::|=)\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (key !== 'name' && key !== 'value' && val) {
        entries.set(key, val);
      }
    }
  }

  return entries;
}

function cleanDisplayValue(val: string | undefined): string {
  if (val === undefined || val === '') {
    return 'Not specified in snapshot';
  }
  return val;
}

function buildChangeImpactAndRisk(
  parameter: string,
  currentValue: string,
  proposedValue: string,
  hypothesis: AiHypothesis
): { expectedImpact: string; potentialRisks: string; evidenceGrounding: string } {
  const key = parameter.toLowerCase();
  const resource = hypothesis.telemetrySpanEvidence?.culpritResource || 'downstream dependency';
  const span = hypothesis.telemetrySpanEvidence?.spanName;
  const spanDuration = hypothesis.telemetrySpanEvidence?.durationMs;
  const baseline = hypothesis.telemetrySpanEvidence?.normalBaselineMs;

  const hasMetricsGap =
    hypothesis.metricsEvidence &&
    (!hypothesis.metricsEvidence.available || hypothesis.metricsEvidence.missing_metrics.length > 0);
  const hasTraceGap = hypothesis.tracesEvidence && !hypothesis.tracesEvidence.available;
  const telemetryNotice =
    hasMetricsGap || hasTraceGap
      ? 'Supporting telemetry is partial/unavailable; target value headroom is unverified.'
      : hypothesis.metricsEvidence?.available
      ? `Informed by ${hypothesis.metricsEvidence.data_source} metrics for ${hypothesis.metricsEvidence.service}; does not verify safety in live production.`
      : 'Derived from incident hypothesis snapshot; verify current runtime headroom before applying.';

  const spanClause =
    span && typeof spanDuration === 'number' && typeof baseline === 'number'
      ? ` where ${span} spiked to ${spanDuration}ms vs ${baseline}ms baseline`
      : '';

  if (key.includes('pool') && (key.includes('max') || key.includes('size'))) {
    const dbRisk = hypothesis.risks.find((r) => /cpu|aurora|pool|connection|db|postgres/i.test(r));
    return {
      expectedImpact: `Expands connection ceiling (${currentValue} → ${proposedValue}) to relieve connection-wait queueing${spanClause}.`,
      potentialRisks:
        dbRisk ||
        `Allows higher concurrent sessions on ${resource}, which can elevate database CPU, memory, and lock contention if DB headroom is unverified.`,
      evidenceGrounding: telemetryNotice,
    };
  }

  if (key.includes('timeout')) {
    return {
      expectedImpact: `Changes connection wait/operation timeout (${currentValue} → ${proposedValue}) so stalled requests shed load sooner instead of pinning worker threads.`,
      potentialRisks:
        'Tighter timeouts can return early HTTP 503/504 errors during transient latency spikes or initial pool warm-up bursts.',
      evidenceGrounding: telemetryNotice,
    };
  }

  if (key.includes('cache') || key.includes('async')) {
    return {
      expectedImpact: `Updates async/cache behavior (${currentValue} → ${proposedValue}) to reduce synchronous per-request database lookups.`,
      potentialRisks:
        'Introduces a cache consistency window in which recently revoked tokens or state updates may persist until TTL expiry.',
      evidenceGrounding: telemetryNotice,
    };
  }

  if (key.includes('leak')) {
    return {
      expectedImpact: `Adjusts leak detection threshold (${currentValue} → ${proposedValue}) to log connections held beyond expected query duration.`,
      potentialRisks:
        'May generate noisy warnings or extra log volume during legitimate batch queries or slow transactions.',
      evidenceGrounding: telemetryNotice,
    };
  }

  return {
    expectedImpact: `Updates ${parameter} from ${currentValue} to ${proposedValue} per proposed remediation target.`,
    potentialRisks:
      hypothesis.risks[0] ||
      'Behavioral side effects for this parameter are not automatically verified; review blast radius and rollback plan before execution.',
    evidenceGrounding: telemetryNotice,
  };
}

/**
 * Extracts actual configuration differences strictly from oldConfig and newConfig
 * without inventing parameters or values, attaching expected impact and risks per change.
 */
export function extractConfigurationChanges(hypothesis: AiHypothesis): ProposedConfigChangeAnalysis[] {
  const oldText = hypothesis.dryRunDiff?.oldConfig ?? '';
  const newText = hypothesis.dryRunDiff?.newConfig ?? '';

  const oldMap = parseConfigEntries(oldText);
  const newMap = parseConfigEntries(newText);

  const orderedKeys: string[] = [];
  for (const key of oldMap.keys()) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }
  for (const key of newMap.keys()) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  const changedKeys = orderedKeys.filter((k) => oldMap.get(k) !== newMap.get(k));

  if (changedKeys.length > 0) {
    return changedKeys.map((key) => {
      const currentValue = cleanDisplayValue(oldMap.get(key));
      const proposedValue = cleanDisplayValue(newMap.get(key));
      const analysis = buildChangeImpactAndRisk(key, currentValue, proposedValue, hypothesis);
      return {
        parameter: key,
        currentValue,
        proposedValue,
        ...analysis,
      };
    });
  }

  // Fallback for unstructured single/multi-line diffs without inventing parameters
  const oldLines = oldText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const newLines = newText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lineChanges: ProposedConfigChangeAnalysis[] = [];

  for (let i = 0; i < maxLen; i++) {
    const cur = oldLines[i];
    const next = newLines[i];
    if (cur !== next) {
      const currentValue = cleanDisplayValue(cur);
      const proposedValue = cleanDisplayValue(next);
      const paramLabel = `Configuration line ${i + 1}`;
      const analysis = buildChangeImpactAndRisk(paramLabel, currentValue, proposedValue, hypothesis);
      lineChanges.push({
        parameter: paramLabel,
        currentValue,
        proposedValue,
        ...analysis,
      });
    }
  }

  return lineChanges;
}
