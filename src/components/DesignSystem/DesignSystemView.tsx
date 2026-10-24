import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { MetricCard } from '../ui/MetricCard';
import { Palette, Type, Box, ToggleLeft, ShieldAlert, Check, Copy } from 'lucide-react';

export const DesignSystemView: React.FC = () => {
  const [testInput, setTestInput] = useState('kubectl get pods -n core-infra');
  const [testCheckbox, setTestCheckbox] = useState(true);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const copyColor = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1800);
  };

  const colorTokens = [
    { name: 'Canvas Base', hex: '#0B0F17', bgClass: 'bg-[#0B0F17]', textClass: 'text-white', desc: 'Application bedrock for viewports' },
    { name: 'Surface Primary', hex: '#111827', bgClass: 'bg-[#111827]', textClass: 'text-white', desc: 'Container level for cards and toolbars' },
    { name: 'Surface Elevated', hex: '#1F2937', bgClass: 'bg-[#1F2937]', textClass: 'text-white', desc: 'Interactive surfaces, flyout drawers' },
    { name: 'Surface Subdued', hex: '#080C13', bgClass: 'bg-[#080C13]', textClass: 'text-white', desc: 'Terminals, code blocks, query inputs' },
    { name: 'Primary Blue', hex: '#3B82F6', bgClass: 'bg-[#3B82F6]', textClass: 'text-white', desc: 'Principal action buttons & focused outlines' },
    { name: 'Critical Red', hex: '#EF4444', bgClass: 'bg-[#EF4444]', textClass: 'text-white', desc: 'SEV-0 / SEV-1 failure alerts, abort actions' },
    { name: 'Warning Amber', hex: '#F59E0B', bgClass: 'bg-[#F59E0B]', textClass: 'text-black', desc: 'Latency spikes, confidence drops' },
    { name: 'Operational Green', hex: '#10B981', bgClass: 'bg-[#10B981]', textClass: 'text-black', desc: 'Resolved states, verified health checks' },
    { name: 'Border Crisp', hex: '#374151', bgClass: 'bg-[#374151]', textClass: 'text-white', desc: 'Card perimeters and panel boundaries' },
    { name: 'Border Default', hex: '#1F2937', bgClass: 'bg-[#1F2937]', textClass: 'text-white', desc: 'Low-contrast row separators' },
  ];

  return (
    <div className="space-y-8">
      {/* Intro Header */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-[#3B82F6]" />
          <h2 className="text-base font-semibold text-[#F9FAFB] tracking-tight">
            IncidentPilot Design System Specification
          </h2>
        </div>
        <p className="text-xs text-[#9CA3AF] mt-1 max-w-3xl leading-relaxed">
          High-stakes, operationally disciplined visual framework built for Site Reliability Engineers, platform architects, and incident commanders. Built upon <strong>Technical Modernism</strong>—prioritizing signal fidelity, zero-pill discipline, tabular telemetry, and verifiable human-in-the-loop checkpoints.
        </p>
      </div>

      {/* 1. Color Palette Tokens */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-[#3B82F6]" />
            <h3 className="text-sm font-semibold text-[#F9FAFB]">
              Color Architecture & Tonal Hierarchy
            </h3>
          </div>
          <span className="text-[11px] font-mono text-[#6B7280]">
            Click any swatch to copy HEX
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {colorTokens.map((token) => (
            <div
              key={token.name}
              onClick={() => copyColor(token.hex)}
              className="bg-[#080C13] border border-[#1F2937] hover:border-[#374151] rounded p-3 cursor-pointer transition-all space-y-2 group"
            >
              <div
                className={`w-full h-10 rounded border border-[#374151] ${token.bgClass} flex items-center justify-center text-xs font-mono font-bold ${token.textClass}`}
              >
                {copiedHex === token.hex ? 'COPIED' : ''}
              </div>
              <div>
                <div className="text-xs font-semibold text-[#F9FAFB]">{token.name}</div>
                <div className="text-[11px] font-mono text-[#60A5FA] group-hover:underline">
                  {token.hex}
                </div>
                <div className="text-[10px] text-[#6B7280] mt-1 line-clamp-2">
                  {token.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Typography Token Scale */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#1F2937] pb-3">
          <Type className="w-4 h-4 text-[#3B82F6]" />
          <h3 className="text-sm font-semibold text-[#F9FAFB]">
            Typography Pairing: Inter & JetBrains Mono (Tabular Numerals)
          </h3>
        </div>

        <div className="space-y-4 font-mono text-xs">
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <div className="border-b border-[#1F2937] pb-2 flex justify-between text-[11px] text-[#6B7280]">
              <span>TOKEN / STYLE</span>
              <span>FONT FAMILY & SPECIFICATION</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <span className="font-sans text-2xl font-semibold text-[#F9FAFB]">
                Headline XL (32px / -0.02em)
              </span>
              <span className="text-[11px] text-[#60A5FA]">Inter SemiBold 600</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <span className="font-sans text-lg font-semibold text-[#F9FAFB]">
                Headline LG (24px / -0.015em)
              </span>
              <span className="text-[11px] text-[#60A5FA]">Inter SemiBold 600</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <span className="font-sans text-sm text-[#C2C6D6]">
                Body MD (13px / 20px line-height) — Fatigue-resistant reading under high operational pressure.
              </span>
              <span className="text-[11px] text-[#9CA3AF]">Inter Regular 400</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 pt-2 border-t border-[#1F2937]">
              <span className="font-mono text-xs font-semibold text-[#DCE2F3] tabular-nums">
                Label MD: 1,840.42 ms • ID: tr-8f4b1029 • STATUS: HTTP 504
              </span>
              <span className="text-[11px] text-[#34D399]">JetBrains Mono tabular-nums</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Button Component States */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#1F2937] pb-3">
          <Box className="w-4 h-4 text-[#3B82F6]" />
          <h3 className="text-sm font-semibold text-[#F9FAFB]">
            Button Control Specs (Radius 0.25rem / JetBrains Mono)
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <span className="text-[11px] font-mono text-[#9CA3AF] block">Primary Action (#3B82F6)</span>
            <div className="space-y-2">
              <Button variant="primary" size="lg" className="w-full">
                Deploy Hotfix
              </Button>
              <Button variant="primary" size="md" className="w-full">
                Approve & Execute
              </Button>
              <Button variant="primary" size="sm" className="w-full">
                Quick Action
              </Button>
            </div>
          </div>

          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <span className="text-[11px] font-mono text-[#9CA3AF] block">Destructive Action (#EF4444)</span>
            <div className="space-y-2">
              <Button variant="destructive" size="lg" className="w-full">
                Declare Outage
              </Button>
              <Button variant="destructive" size="md" className="w-full">
                Teardown Node
              </Button>
              <Button variant="destructive" size="sm" className="w-full">
                Kill Process
              </Button>
            </div>
          </div>

          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <span className="text-[11px] font-mono text-[#9CA3AF] block">Secondary / Outline (#374151)</span>
            <div className="space-y-2">
              <Button variant="secondary" size="lg" className="w-full">
                Export Audit Log
              </Button>
              <Button variant="secondary" size="md" className="w-full">
                Reject Hypothesis
              </Button>
              <Button variant="secondary" size="sm" className="w-full">
                View Logs
              </Button>
            </div>
          </div>

          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <span className="text-[11px] font-mono text-[#9CA3AF] block">Ghost Action (Transparent)</span>
            <div className="space-y-2">
              <Button variant="ghost" size="lg" className="w-full">
                Dismiss Notice
              </Button>
              <Button variant="ghost" size="md" className="w-full">
                Cancel Inspection
              </Button>
              <Button variant="ghost" size="sm" className="w-full">
                Clear Filters
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Chips & Status Badges */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#1F2937] pb-3">
          <ShieldAlert className="w-4 h-4 text-[#3B82F6]" />
          <h3 className="text-sm font-semibold text-[#F9FAFB]">
            Chips & Status Badges (Non-Pill, 0.25rem Radius, 6px Square Indicators)
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-[#080C13] border border-[#1F2937] rounded p-4">
          <Badge variant="critical">SEV-0 CRITICAL</Badge>
          <Badge variant="critical">SEV-1 OUTAGE</Badge>
          <Badge variant="warning" showSquare>SEV-2 DEGRADED</Badge>
          <Badge variant="healthy" showSquare>SEV-3 RESOLVED</Badge>
          <Badge variant="ai-hypothesis" confidence={94.2} />
          <Badge variant="neutral">K8S NODE NOMINAL</Badge>
        </div>
      </div>

      {/* 5. Inputs & Checkboxes */}
      <div className="bg-[#111827] border border-[#374151] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#1F2937] pb-3">
          <ToggleLeft className="w-4 h-4 text-[#3B82F6]" />
          <h3 className="text-sm font-semibold text-[#F9FAFB]">
            Form Controls: Focus Rings & Squared Checkboxes
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-2">
            <label className="text-[11px] font-mono text-[#9CA3AF] block">
              Terminal Query Input (Focus state with #3B82F6 border & ring)
            </label>
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              className="w-full bg-[#080C13] border border-[#374151] focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] text-[#F9FAFB] text-xs font-mono p-2.5 rounded outline-none transition-all"
            />
          </div>

          <div className="bg-[#080C13] border border-[#1F2937] rounded p-4 space-y-3">
            <span className="text-[11px] font-mono text-[#9CA3AF] block">
              Squared Geometry Checkbox (0.125rem radius)
            </span>
            <label className="flex items-center gap-2 text-xs font-mono text-[#DCE2F3] cursor-pointer">
              <input
                type="checkbox"
                checked={testCheckbox}
                onChange={() => setTestCheckbox(!testCheckbox)}
                className="rounded-[2px] border-[#4B5563] bg-[#111827] text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0 cursor-pointer"
              />
              <span>--enable-automatic-canary-verification (checked: {testCheckbox ? 'true' : 'false'})</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
