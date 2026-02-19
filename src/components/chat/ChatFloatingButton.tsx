import { useState } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ChatCore } from './ChatCore';

export function ChatFloatingButton() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const handleExpand = () => {
    setIsOpen(false);
    navigate('/chat');
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-14 rounded-full bg-[#13274F] text-white shadow-lg hover:bg-[#1a3468] transition-all hover:scale-105 flex items-center justify-center gap-2 px-5"
          title="Open AI Analyst"
        >
          <img
            alt="PerceptionX"
            className="h-6 w-6 object-contain shrink-0 brightness-0 invert"
            src="/logos/perceptionx-small.png"
          />
          <span className="text-sm font-medium whitespace-nowrap">Ask AI</span>
          <span className="text-[10px] font-semibold bg-[#DB5E89] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
        </button>
      )}

      {/* Chat panel (Sheet) */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[440px] p-0 flex flex-col gap-0 [&>button]:hidden"
        >
          {/* Custom header (replacing default sheet close) */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-2">
              <img
                alt="PerceptionX"
                className="w-7 h-7 object-contain rounded-full"
                src="/logos/PinkBadge.png"
              />
              <SheetTitle className="text-sm font-semibold">AI Analyst</SheetTitle>
              <span className="text-[10px] font-semibold bg-[#0DBCBA] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-gray-600"
                onClick={handleExpand}
                title="Open full page"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-gray-600"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Chat content */}
          <div className="flex-1 overflow-hidden">
            <ChatCore mode="compact" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
