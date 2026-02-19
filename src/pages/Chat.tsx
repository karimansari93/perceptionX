import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { ChatCore } from '@/components/chat/ChatCore';
import { useNavigate, useLocation } from 'react-router-dom';

function ChatContent() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-50 w-full">
      <AppSidebar
        activeSection="chat"
        onSectionChange={() => {}}
      />
      <SidebarInset className="flex-1 flex flex-col">
        {/* Minimal header */}
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-white/80 backdrop-blur-sm">
          <img
            alt="PerceptionX"
            className="w-8 h-8 object-contain rounded-full"
            src="/logos/PinkBadge.png"
          />
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Employer Perception Analyst</h1>
            <p className="text-xs text-gray-500">Ask questions about your organization's AI employer perception data</p>
          </div>
        </div>

        {/* Full-page chat */}
        <div className="flex-1 overflow-hidden">
          <ChatCore mode="full" />
        </div>
      </SidebarInset>
    </div>
  );
}

export default function Chat() {
  return (
    <SidebarProvider>
      <ChatContent />
    </SidebarProvider>
  );
}
