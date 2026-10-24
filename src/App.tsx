import React, { useState } from 'react';
import { Header, NavTab } from './components/Header';
import { WarRoomView } from './components/WarRoom/WarRoomView';
import { TriageView } from './components/Triage/TriageView';
import { TopologyView } from './components/Topology/TopologyView';
import { AuditView } from './components/Audit/AuditView';
import { DesignSystemView } from './components/DesignSystem/DesignSystemView';
import { DeclareIncidentModal } from './components/DeclareIncidentModal';
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
import { Incident } from './types/incident';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('warroom');
  const [activeIncident, setActiveIncident] = useState<Incident>(initialActiveIncident);
  const [allIncidents, setAllIncidents] = useState<Incident[]>(allIncidentsList);
  const [isDeclareModalOpen, setIsDeclareModalOpen] = useState(false);

  const handleSelectIncident = (inc: Incident) => {
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

    setAllIncidents((prev) => [fullNewIncident, ...prev]);
    setActiveIncident(fullNewIncident);
    setActiveTab('warroom');
  };

  return (
    <div className="min-h-screen bg-[#0C141F] text-[#DCE2F3] flex flex-col font-sans">
      {/* Top Bar Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenDeclareModal={() => setIsDeclareModalOpen(true)}
        activeSeverity={activeIncident.severity}
      />

      {/* Mobile Sub-Navigation Bar */}
      <div className="md:hidden flex items-center overflow-x-auto bg-[#080C13] border-b border-[#1F2937] px-4 py-2 gap-3 text-xs font-mono">
        <button
          onClick={() => setActiveTab('warroom')}
          className={`px-2.5 py-1 rounded whitespace-nowrap cursor-pointer ${
            activeTab === 'warroom' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF]'
          }`}
        >
          War Room
        </button>
        <button
          onClick={() => setActiveTab('triage')}
          className={`px-2.5 py-1 rounded whitespace-nowrap cursor-pointer ${
            activeTab === 'triage' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF]'
          }`}
        >
          Queue
        </button>
        <button
          onClick={() => setActiveTab('topology')}
          className={`px-2.5 py-1 rounded whitespace-nowrap cursor-pointer ${
            activeTab === 'topology' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF]'
          }`}
        >
          Topology
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-2.5 py-1 rounded whitespace-nowrap cursor-pointer ${
            activeTab === 'audit' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF]'
          }`}
        >
          Audit
        </button>
        <button
          onClick={() => setActiveTab('design-system')}
          className={`px-2.5 py-1 rounded whitespace-nowrap cursor-pointer ${
            activeTab === 'design-system' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA3AF]'
          }`}
        >
          Design System
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'warroom' && (
          <WarRoomView
            incident={activeIncident}
            hypothesis={initialAiHypothesis}
            pods={initialPods}
            spans={initialTraceSpans}
            logs={initialTelemetryLogs}
            onNavigateToAudit={() => setActiveTab('audit')}
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

        {activeTab === 'audit' && (
          <AuditView events={auditEventsList} activeIncident={activeIncident} />
        )}

        {activeTab === 'design-system' && <DesignSystemView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1F2937] bg-[#080C13] text-[#6B7280] text-xs font-mono py-4 px-6">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            IncidentPilot Platform • SRE High-Stakes War Room & Autonomous Remediation
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Cluster: prod-us-east-k8s</span>
            <span>•</span>
            <span>Auth Gate: HikariCP v2.14</span>
            <span>•</span>
            <span className="text-[#34D399]">Telemetry Heartbeat 100%</span>
          </div>
        </div>
      </footer>

      {/* Modal Dialog */}
      <DeclareIncidentModal
        isOpen={isDeclareModalOpen}
        onClose={() => setIsDeclareModalOpen(false)}
        onDeclare={handleDeclareIncident}
      />
    </div>
  );
}
