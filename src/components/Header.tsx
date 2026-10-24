import React from 'react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { ShieldAlert, Radio, AlertOctagon } from 'lucide-react';

export type NavTab = 'warroom' | 'triage' | 'topology' | 'audit' | 'design-system';

interface HeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenDeclareModal: () => void;
  activeSeverity?: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenDeclareModal,
  activeSeverity = 'SEV-1',
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#0B0F17]/95 backdrop-blur-md border-b border-[#1F2937] px-4 sm:px-6 py-3 flex items-center justify-between gap-4 md:gap-8 transition-colors">
      {/* Zone 1: Brand Wordmark (Single text element in display face, no subtitles or descriptor pill badges) */}
      <div className="flex items-center gap-3 shrink-0">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('warroom');
          }}
          className="text-lg font-bold tracking-tight text-[#F9FAFB] hover:text-[#3B82F6] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
        >
          <span className="w-2.5 h-2.5 bg-[#EF4444] rounded-none shrink-0" />
          <span>IncidentPilot</span>
        </a>
      </div>

      {/* Zone 2: 4-5 concise single-line navigation links with subtle hover underlines */}
      <nav className="hidden md:flex items-center gap-6 text-xs font-mono font-medium text-[#9CA3AF]">
        <button
          onClick={() => onSelectTab('warroom')}
          className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer py-1 ${
            activeTab === 'warroom'
              ? 'text-[#F9FAFB] border-b-2 border-[#3B82F6] font-semibold'
              : ''
          }`}
        >
          <span>Active War Room</span>
          <span className="bg-red-950/80 text-[#F87171] border border-red-800 text-[10px] px-1 py-0.2 rounded font-mono">
            {activeSeverity}
          </span>
        </button>

        <button
          onClick={() => onSelectTab('triage')}
          className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 ${
            activeTab === 'triage'
              ? 'text-[#F9FAFB] border-b-2 border-[#3B82F6] font-semibold'
              : ''
          }`}
        >
          Incident Queue
        </button>

        <button
          onClick={() => onSelectTab('topology')}
          className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 ${
            activeTab === 'topology'
              ? 'text-[#F9FAFB] border-b-2 border-[#3B82F6] font-semibold'
              : ''
          }`}
        >
          Service Topology
        </button>

        <button
          onClick={() => onSelectTab('audit')}
          className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 ${
            activeTab === 'audit'
              ? 'text-[#F9FAFB] border-b-2 border-[#3B82F6] font-semibold'
              : ''
          }`}
        >
          Audit & Post-Mortem
        </button>

        <button
          onClick={() => onSelectTab('design-system')}
          className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 ${
            activeTab === 'design-system'
              ? 'text-[#F9FAFB] border-b-2 border-[#3B82F6] font-semibold'
              : ''
          }`}
        >
          Design System
        </button>
      </nav>

      {/* Zone 3: 1 Primary Action */}
      <div className="flex items-center gap-3 shrink-0">
        <Button
          variant="destructive"
          size="sm"
          onClick={onOpenDeclareModal}
          icon={<AlertOctagon className="w-3.5 h-3.5" />}
        >
          Declare Outage
        </Button>
      </div>
    </header>
  );
};
