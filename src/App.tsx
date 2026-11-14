import React, { useState, useEffect, useCallback } from 'react';
import { Header, NavTab } from './components/Header';
import { WarRoomView } from './components/WarRoom/WarRoomView';
import { TriageView } from './components/Triage/TriageView';
import { TopologyView } from './components/Topology/TopologyView';
import { AuditView } from './components/Audit/AuditView';
import { IncidentDashboardView } from './components/Audit/IncidentDashboardView';
import { DeclareIncidentModal } from './components/DeclareIncidentModal';
import { N8nSetupGuideModal } from './components/N8nSetupGuideModal';
import {
  initialActiveIncident,
  initialAiHypothesis,
  initialPods,
  initialTraceSpans,
  initialTelemetryLogs,
  allIncidentsList,
  topologyServices,
  auditEventsList,
} from './data/mockData';
import { Incident, AuditEvent, N8nWorkflowResponse } from './types/incident';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('warroom');
  const [activeIncident, setActiveIncident] = useState<Incident>(initialActiveIncident);
  const [allIncidents, setAllIncidents] = useState<Incident[]>(allIncidentsList);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(auditEventsList);
  const [isDeclareModalOpen, setIsDeclareModalOpen] = useState(false);
  const [isSetupGuideOpen, setIsSetupGuideOpen] = useState(false);
  const [isIncidentDashboardOpen, setIsIncidentDashboardOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  const syncServerAuditEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/audit');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.events) && data.events.length > 0) {
        setAuditEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const fresh = (data.events as AuditEvent[]).filter((e) => !existingIds.has(e.id));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
      }
    } catch {
      // Non-fatal if audit endpoint is unreachable
    }
  }, []);

  useEffect(() => {
    syncServerAuditEvents();
  }, [activeTab, isIncidentDashboardOpen, syncServerAuditEvents]);

  const handleSelectTab = (tab: NavTab) => {
    setIsIncidentDashboardOpen(false);
    setActiveTab(tab);
  };

  const handleAuditEventRecorded = (event: AuditEvent) => {
    setAuditEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]));
  };

  const handleSelectIncident = (inc: Incident) => {
    setIsIncidentDashboardOpen(false);
    setActiveIncident(inc);
    setActiveTab('warroom');
  };

  const handleDeclareIncident = (newIncData: Partial<Incident>) => {
    const fullNewIncident: Incident = {
      id: `inc-${Date.now()}`,
      code: newIncData.code || 'INC-4999',
      title: newIncData.title || 'Production Outage',
      severity: newIncData.severity || 'SEV-1',
      status: 'investigating',
      service: newIncData.service || 'checkout-api',
      commander: newIncData.commander || {
        name: 'Sarah Chen',
        role: 'Staff SRE / Incident Commander',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
      },
      startedAt: 'Just now',
      durationMinutes: 1,
      impactSummary: newIncData.impactSummary || 'Outage declared.',
      affectedUsersCount: newIncData.affectedUsersCount || 5000,
      blastRadius: newIncData.blastRadius || 'Global Service',
      p99LatencyMs: newIncData.p99LatencyMs || 840,
      errorRatePercent: newIncData.errorRatePercent || 12.0,
    };

    setIsIncidentDashboardOpen(false);
    setAllIncidents((prev) => [fullNewIncident, ...prev]);
    setActiveIncident(fullNewIncident);
    setActiveTab('warroom');
  };

  /**
   * Handle real verified workflow response (Node.js Orchestrator or Legacy n8n Webhook)
   * Updates incident state and appends audit event when triggered via legacy n8n
   */
  const handleExecutionCompleteWithResult = (result: N8nWorkflowResponse) => {
    const isNativeNodejs = result.raw?.engine === 'nodejs_express_native';

    if (!isNativeNodejs) {
      const timeFormatted = result.execution_timestamp
        ? new Date(result.execution_timestamp).toTimeString().split(' ')[0] + ' UTC'
        : new Date().toTimeString().split(' ')[0] + ' UTC';

      const newAuditEvent: AuditEvent = {
        id: `aud-${Date.now()}`,
        timestamp: timeFormatted,
        actorType: 'N8N_WORKFLOW',
        actorName: 'n8n Production Workflow',
        action: `Remediation Workflow Executed (Status: ${result.workflow_status || 'completed'})`,
        details: `[Approval ID: ${result.approval_id}] Result: ${result.result_message}. Simulated execution verified on target service ${activeIncident.service}.`,
        verificationStatus: result.success ? 'verified' : 'failed',
      };

      setAuditEvents((prev) => [newAuditEvent, ...prev]);
    } else {
      syncServerAuditEvents();
    }

    const updatedInc: Incident = {
      ...activeIncident,
      status: 'resolved',
      workflowStatus: result.workflow_status,
      lastApprovalResult: result,
      p99LatencyMs: 42,
      errorRatePercent: 0.1,
    };

    setActiveIncident(updatedInc);
    setAllIncidents((prev) =>
      prev.map((inc) => (inc.id === activeIncident.id ? updatedInc : inc))
    );
  };

  const handleRejectionComplete = () => {
    syncServerAuditEvents();
    const updatedInc: Incident = {
      ...activeIncident,
      workflowStatus: 'rejected',
    };
    setActiveIncident(updatedInc);
    setAllIncidents((prev) =>
      prev.map((inc) => (inc.id === activeIncident.id ? updatedInc : inc))
    );
  };

  return (
    <div className="min-h-screen bg-[var(--ip-canvas)] text-[var(--ip-text)] flex flex-col font-sans overflow-x-hidden transition-colors duration-150">
      {/* Top Bar Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenDeclareModal={() => setIsDeclareModalOpen(true)}
      />

      {/* Mobile Sub-Navigation Bar */}
      <div className="md:hidden flex items-center overflow-x-auto bg-[var(--ip-surface-alt)] border-b border-[var(--ip-border)] px-4 py-2 gap-1.5 text-xs">
        {(
          [
            { id: 'warroom', label: 'War Room' },
            { id: 'triage', label: 'Queue' },
            { id: 'topology', label: 'Topology' },
            { id: 'audit', label: 'Audit Trail' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSelectTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'neu-pill text-[var(--ip-text)] font-medium'
                : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 min-w-0">
        {activeTab === 'warroom' && (
          <WarRoomView
            incident={activeIncident}
            hypothesis={initialAiHypothesis}
            pods={initialPods}
            spans={initialTraceSpans}
            logs={initialTelemetryLogs}
            services={topologyServices}
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
            onNavigateToAudit={() => setActiveTab('audit')}
            onExecutionCompleteWithResult={handleExecutionCompleteWithResult}
            onRejectionComplete={handleRejectionComplete}
            onAuditEventRecorded={handleAuditEventRecorded}
            onOpenSetupGuide={() => setIsSetupGuideOpen(true)}
          />
        )}

        {activeTab === 'triage' && (
          <TriageView
            incidents={allIncidents}
            onSelectIncident={handleSelectIncident}
            onOpenDeclareModal={() => setIsDeclareModalOpen(true)}
          />
        )}

        {activeTab === 'topology' && <TopologyView services={topologyServices} />}

        {activeTab === 'audit' && !isIncidentDashboardOpen && (
          <AuditView
            events={auditEvents}
            activeIncident={activeIncident}
            onOpenIncidentDashboard={() => setIsIncidentDashboardOpen(true)}
          />
        )}

        {activeTab === 'audit' && isIncidentDashboardOpen && (
          <IncidentDashboardView
            incident={activeIncident}
            auditEvents={auditEvents}
            onBackToAudit={() => setIsIncidentDashboardOpen(false)}
            onOpenWarRoom={() => handleSelectTab('warroom')}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--ip-border)] bg-[var(--ip-canvas)] text-[var(--ip-text-muted)] text-xs py-4 px-6">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>IncidentPilot · Human-in-the-Loop Incident Command</div>
          <div className="flex items-center gap-4 text-[11px]">
            <button
              onClick={() => setIsSetupGuideOpen(true)}
              className="text-[#2563EB] dark:text-[#60A5FA] hover:underline cursor-pointer"
            >
              Integration & Secrets Guide
            </button>
            <span aria-hidden="true">·</span>
            <span>simulation_mode=true enforced</span>
          </div>
        </div>
      </footer>

      {/* Declare Incident Modal Dialog */}
      <DeclareIncidentModal
        isOpen={isDeclareModalOpen}
        onClose={() => setIsDeclareModalOpen(false)}
        onDeclare={handleDeclareIncident}
      />

      {/* N8N Setup Guide Modal Dialog */}
      <N8nSetupGuideModal
        isOpen={isSetupGuideOpen}
        onClose={() => setIsSetupGuideOpen(false)}
      />
    </div>
  );
}
