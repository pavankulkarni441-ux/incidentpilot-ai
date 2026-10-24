import React, { useState, useEffect } from 'react';
import { Incident, AiHypothesis, PodMetric, TraceSpan, TelemetryLog } from '../../types/incident';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MetricCard } from '../ui/MetricCard';
import { AiApprovalCard } from './AiApprovalCard';
import { ExecutionTerminalModal } from './ExecutionTerminalModal';
import { TraceWaterfall } from './TraceWaterfall';
import { PodHealthMatrix } from './PodHealthMatrix';
import { TelemetryLogFeed } from './TelemetryLogFeed';
import {
  Clock,
  User,
  AlertTriangle,
  RotateCcw,
  Zap,
  CheckCircle2,
  Shield,
  Radio,
  FileText,
} from 'lucide-react';

interface WarRoomViewProps {
  incident: Incident;
  hypothesis: AiHypothesis;
  pods: PodMetric[];
  spans: TraceSpan[];
  logs: TelemetryLog[];
  onNavigateToAudit?: () => void;
}

export const WarRoomView: React.FC<WarRoomViewProps> = ({
  incident: propIncident,
  hypothesis: propHypothesis,
  pods: propPods,
  spans,
  logs: propLogs,
  onNavigateToAudit,
}) => {
  const [incident, setIncident] = useState<Incident>(propIncident);
  const [hypothesis, setHypothesis] = useState<AiHypothesis>(propHypothesis);
  const [pods, setPods] = useState<PodMetric[]>(propPods);
  const [isMitigated, setIsMitigated] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [appliedFlags, setAppliedFlags] = useState<{ [key: string]: boolean }>({});
  const [activeSeconds, setActiveSeconds] = useState(18 * 60 + 42); // 18m 42s

  // Live elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleApprove = (flags: { [key: string]: boolean }) => {
    setAppliedFlags(flags);
    setIsModalOpen(true);
  };

  const handleExecutionComplete = () => {
    setIsMitigated(true);
    setIncident((prev) => ({
      ...prev,
      status: 'resolved',
      p99LatencyMs: 42,
      errorRatePercent: 0.1,
    }));
    setHypothesis((prev) => ({
      ...prev,
      status: 'executed_verified',
    }));
    setPods((prev) =>
      prev.map((pod) => ({
        ...pod,
        status: 'Running',
        cpuUsage: 38.4,
        activeConnections: 12,
        maxConnections: 60,
      }))
    );
  };

  const handleReject = (reason: string) => {
    setHypothesis((prev) => ({
      ...prev,
      status: 'rejected',
    }));
    alert(`Hypothesis rejected. Rationale logged: "${reason}". AI synthesizer requested to formulate alternate runbook.`);
  };

  const handleReset = () => {
    setIsMitigated(false);
    setIncident(propIncident);
    setHypothesis(propHypothesis);
    setPods(propPods);
  };

  return (
    <div className="space-y-6">
      {/* Incident Status Banner */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant={isMitigated ? 'healthy' : 'critical'} showSquare={!isMitigated}>
                {isMitigated ? 'INCIDENT RESOLVED' : incident.severity}
              </Badge>
              <span className="font-mono text-xs font-semibold text-[#60A5FA] bg-[#19202B] px-2 py-0.5 rounded border border-[#232A36]">
                {incident.code}
              </span>
              <span className="text-xs font-mono text-[#9CA3AF]">
                Service: <strong className="text-[#DCE2F3]">{incident.service}</strong>
              </span>
              <span className="text-xs font-mono text-[#6B7280]">
                Status:{' '}
                <strong className={isMitigated ? 'text-[#34D399] uppercase' : 'text-[#FBBF24] uppercase'}>
                  {incident.status}
                </strong>
              </span>
            </div>

            <h1 className="text-lg sm:text-xl font-semibold text-[#F9FAFB] tracking-tight">
              {incident.title}
            </h1>

            <p className="text-xs sm:text-sm text-[#C2C6D6] max-w-4xl">
              {incident.impactSummary}
            </p>
          </div>

          {/* Commander & Live Duration Controls */}
          <div className="flex flex-wrap lg:flex-col items-start lg:items-end gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#1F2937]">
            <div className="flex items-center gap-2 bg-[#080C13] border border-[#374151] px-3 py-1.5 rounded">
              <Clock className="w-4 h-4 text-[#F59E0B]" />
              <div className="text-xs font-mono">
                <span className="text-[#6B7280] block text-[10px]">TTR ELAPSED</span>
                <span className="font-bold text-[#F9FAFB] tabular-nums text-sm">
                  {formatTimer(activeSeconds)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <div className="w-6 h-6 rounded bg-[#1F2937] border border-[#374151] flex items-center justify-center text-[#9CA3AF]">
                <User className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-[#6B7280] block text-[10px]">INCIDENT COMMANDER</span>
                <span className="text-[#DCE2F3] font-medium">{incident.commander.name}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 mt-1">
              {isMitigated ? (
                <Button variant="secondary" size="sm" onClick={handleReset} icon={<RotateCcw className="w-3.5 h-3.5" />}>
                  Re-arm Outage Scenario
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExecutionComplete}
                  icon={<Zap className="w-3.5 h-3.5 text-[#3B82F6]" />}
                >
                  Force Instant Resolve
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Blast radius strip */}
        <div className="mt-4 pt-3 border-t border-[#1F2937] flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#9CA3AF]">
          <div>
            Blast Radius: <strong className="text-[#DCE2F3]">{incident.blastRadius}</strong>
          </div>
          <div>
            Impacted Traffic:{' '}
            <strong className={isMitigated ? 'text-[#34D399]' : 'text-[#EF4444]'}>
              {isMitigated ? '0 active requests dropped' : `${incident.affectedUsersCount.toLocaleString()} sessions throttled`}
            </strong>
          </div>
          <div className="text-[#6B7280]">
            Opened: {incident.startedAt}
          </div>
        </div>
      </div>

      {/* Real-time Telemetry Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Gateway p99 Latency"
          value={isMitigated ? '42' : '1,840'}
          unit="ms"
          change={isMitigated ? '-97.7%' : '+1,240%'}
          changeType={isMitigated ? 'positive' : 'negative'}
          statusColor={isMitigated ? 'emerald' : 'red'}
          annotation={isMitigated ? 'Baseline normal (<50ms)' : 'SLO breached (>500ms)'}
          sparklineData={
            isMitigated
              ? [1840, 1420, 890, 420, 110, 45, 42, 42, 41, 42]
              : [42, 45, 60, 180, 450, 920, 1340, 1720, 1840, 1840]
          }
        />

        <MetricCard
          label="HTTP 5xx Error Rate"
          value={isMitigated ? '0.08' : '14.8'}
          unit="%"
          change={isMitigated ? '-99.4%' : '+14.2%'}
          changeType={isMitigated ? 'positive' : 'negative'}
          statusColor={isMitigated ? 'emerald' : 'red'}
          annotation={isMitigated ? 'Error budget nominal' : 'Target: < 0.10%'}
          sparklineData={
            isMitigated
              ? [14.8, 12.2, 8.4, 3.1, 0.9, 0.2, 0.1, 0.08, 0.08, 0.08]
              : [0.05, 0.08, 0.12, 1.4, 4.2, 8.9, 11.4, 13.2, 14.8, 14.8]
          }
        />

        <MetricCard
          label="HikariCP Active Pool"
          value={isMitigated ? '14' : '20'}
          unit={isMitigated ? '/ 60 Max' : '/ 20 Saturated'}
          change={isMitigated ? '23% Headroom' : '100% Locked'}
          changeType={isMitigated ? 'positive' : 'negative'}
          statusColor={isMitigated ? 'emerald' : 'red'}
          annotation={isMitigated ? '46 idle slots available' : 'Queue wait: 1,814ms'}
          sparklineData={
            isMitigated
              ? [20, 20, 18, 16, 14, 14, 14, 13, 14, 14]
              : [12, 14, 16, 19, 20, 20, 20, 20, 20, 20]
          }
        />

        <MetricCard
          label="AI Mitigation Confidence"
          value="94.2"
          unit="%"
          change="High Precision"
          changeType="positive"
          statusColor="blue"
          annotation="Cross-verified via 1,420 spans"
          sparklineData={[70, 75, 82, 88, 91, 93, 94.2, 94.2, 94.2, 94.2]}
        />
      </div>

      {/* Flagship: Human-in-the-Loop AI Approval Card */}
      {isMitigated ? (
        <div className="bg-[#111827] border border-[#10B981]/50 rounded-lg p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-[#10B981]/10 border border-[#10B981]/40 flex items-center justify-center text-[#34D399]">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[#F9FAFB]">
                  Hotfix Patch Successfully Executed & Verified
                </span>
                <Badge variant="healthy">STABILIZED</Badge>
              </div>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                HikariCP connection pool expanded to 60 with asynchronous revocation token bypass enabled.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToAudit && (
              <Button
                variant="primary"
                size="sm"
                onClick={onNavigateToAudit}
                icon={<FileText className="w-3.5 h-3.5" />}
              >
                View Post-Mortem Retrospective
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleReset}>
              Reset State
            </Button>
          </div>
        </div>
      ) : (
        <AiApprovalCard
          hypothesis={hypothesis}
          onApprove={handleApprove}
          onReject={handleReject}
          isExecuting={isModalOpen}
        />
      )}

      {/* Interactive Trace Waterfall & Span Inspector */}
      <TraceWaterfall spans={spans} />

      {/* Kubernetes Pod Health Matrix */}
      <PodHealthMatrix pods={pods} />

      {/* Live Telemetry Log Feed with fixed-width slots */}
      <TelemetryLogFeed initialLogs={propLogs} isMitigated={isMitigated} />

      {/* Live Execution Terminal Modal */}
      <ExecutionTerminalModal
        isOpen={isModalOpen}
        flags={appliedFlags}
        onComplete={handleExecutionComplete}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};
