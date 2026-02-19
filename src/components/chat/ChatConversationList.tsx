import { cn } from '@/lib/utils';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatConversation } from '@/services/chatService';

interface ChatConversationListProps {
  conversations: ChatConversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onDelete: (conversationId: string) => void;
}

export function ChatConversationList({
  conversations,
  currentConversationId,
  isLoading,
  onSelect,
  onNew,
  onDelete,
}: ChatConversationListProps) {
  return (
    <div className="flex flex-col h-full border-r bg-gray-50/50">
      <div className="p-3 border-b">
        <Button
          onClick={onNew}
          variant="outline"
          className="w-full justify-start gap-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs text-gray-400">No conversations yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((convo) => (
              <div
                key={convo.id}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors',
                  currentConversationId === convo.id
                    ? 'bg-white shadow-sm border border-gray-200 text-gray-900'
                    : 'text-gray-600 hover:bg-white hover:text-gray-900'
                )}
                onClick={() => onSelect(convo.id)}
              >
                <MessageSquare className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="flex-1 truncate">{convo.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(convo.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
