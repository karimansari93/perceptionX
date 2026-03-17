import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Play, X, Trash2, RotateCcw, RefreshCw, AlertCircle,
} from "lucide-react";

export type QueueItem = {
  id: string;
  company_name: string;
  location: string;
  industry: string;
  job_function: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  phase: "setup" | "search_insights" | "llm_collection" | "done";
  batch_index: number;
  total_prompts: number;
  retry_count: number;
  error_log: string | null;
  is_cancelled: boolean;
};

type Props = {
  queue: QueueItem[];
  processing: boolean;
  logs: string[];
  onStart: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  onClearCompleted: () => void;
  onRefresh: () => void;
};

export const BatchQueuePanel = ({
  queue, processing, logs,
  onStart, onCancel, onRetryFailed, onClearCompleted, onRefresh,
}: Props) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const stats = {
    pending: queue.filter((q) => q.status === "pending" && !q.is_cancelled).length,
    processing: queue.filter((q) => q.status === "processing").length,
    completed: queue.filter((q) => q.status === "completed").length,
    failed: queue.filter((q) => q.status === "failed").length,
    cancelled: queue.filter((q) => q.is_cancelled).length,
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Queue Status</CardTitle>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{stats.pending} pending</Badge>
            <Badge variant="default">{stats.processing} processing</Badge>
            <Badge variant="secondary" className="bg-green-100 text-green-800">{stats.completed} completed</Badge>
            {stats.failed > 0 && <Badge variant="destructive">{stats.failed} failed</Badge>}
            {stats.cancelled > 0 && <Badge variant="outline" className="text-orange-600">{stats.cancelled} cancelled</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={onStart} disabled={processing || stats.pending === 0} size="sm">
            {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {processing ? "Processing..." : "Start Collection"}
          </Button>
          <Button onClick={onCancel} variant="outline" size="sm" disabled={!processing}>
            <X className="h-4 w-4 mr-2" />Cancel
          </Button>
          <Button onClick={onRetryFailed} variant="outline" size="sm" disabled={stats.failed === 0}>
            <RotateCcw className="h-4 w-4 mr-2" />Retry Failed
          </Button>
          <Button onClick={onClearCompleted} variant="ghost" size="sm" disabled={stats.completed === 0}>
            <Trash2 className="h-4 w-4 mr-2" />Clear Completed
          </Button>
          <Button onClick={onRefresh} variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Queue list */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[320px]">
            {queue.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">
                No queue items yet. Configure and click Generate Queue.
              </p>
            ) : (
              <div className="divide-y">
                {queue.map((item) => (
                  <div key={item.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">
                        {item.company_name} — {item.location} / {item.industry}
                        {item.job_function && (
                          <span className="text-muted-foreground"> / {item.job_function}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            item.is_cancelled ? "outline" :
                            item.status === "completed" ? "secondary" :
                            item.status === "failed" ? "destructive" :
                            item.status === "processing" ? "default" : "outline"
                          }
                          className={item.status === "completed" ? "bg-green-100 text-green-800" : ""}
                        >
                          {item.is_cancelled ? "cancelled" : item.status}
                        </Badge>
                        {item.status === "processing" && (
                          <Badge variant="outline" className="text-xs">{item.phase}</Badge>
                        )}
                      </div>
                    </div>
                    {item.status === "processing" && item.phase === "llm_collection" && item.total_prompts > 0 && (
                      <Progress value={(item.batch_index / item.total_prompts) * 100} className="h-1.5" />
                    )}
                    {item.error_log && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {item.error_log}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Processing logs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Processing Logs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[150px] px-4 pb-4">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No logs yet.</p>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
