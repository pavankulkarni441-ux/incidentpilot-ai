import React from 'react';
import { Button } from './ui/Button';
import { AlertOctagon } from 'lucide-react';

export type NavTab = 'warroom' | 'triage' | 'topology' | 'audit';

interface HeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenDeclareModal: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string }[] = [
  { id: 'warroom', label: 'War Room' },
  { id: 'triage', label: 'Incident Queue' },
  { id: 'topology', label: 'Topology' },
  { id: 'audit', label: 'Audit Trail' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenDeclareModal,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[var(--ip-header-bg)] backdrop-blur-md border-b border-[var(--ip-border)] px-4 sm:px-6 lg:px-8 py-3.5">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('warroom');
          }}
          className="text-base sm:text-lg font-semibold tracking-tight text-[var(--ip-text)] hover:text-[#3B82F6] dark:hover:text-[#60A5FA] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] shrink-0" />
          <span>IncidentPilot</span>
        </a>

        {/* Zone 2: Clean 4-item Top Navigation */}
        <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-xl neu-inset">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'neu-pill text-[var(--ip-text)] font-semibold'
                    : 'text-[var(--ip-text-secondary)] hover:text-[var(--ip-text)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
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
      </div>
    </header>
  );
};
