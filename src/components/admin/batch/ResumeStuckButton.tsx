import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

type Props = {
  organizationId: string;
};

/**
 * One-click sweep for company-batch queue rows belonging to this organization
 * that got stranded by the self-chain dying. Resets them to pending and kicks
 * the processor once per affected config.
 *
 * Stranded = status in (pending, processing) AND no updated_at movement in the
 * last 5 minutes. 5 min is comfortably longer than a healthy chunk (~60s).
 */
export const ResumeStuckButton = ({ organizationId }: Props) => {
  const [running, setRunning] = useState(false);

  const handleResume = async () => {
    if (!organizationId) return;
    setRunning(true);

    try {
      // 1. Find configs belonging to this org.
      const { data: configs, error: configErr } = await supabase
        .from("company_batch_configs")
        .select("id")
        .eq("organization_id", organizationId);

      if (configErr) throw new Error(configErr.message);
      const configIds = (configs || []).map((c: any) => c.id);
      if (configIds.length === 0) {
        toast.info("No batch configs for this organization.");
        return;
      }

      // 2. Find stranded queue rows (stuck processing >5 min, or pending that
      //    nothing has touched).
      const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: stuckRows, error: stuckErr } = await supabase
        .from("company_batch_queue")
        .select("id, config_id, status, updated_at")
        .in("config_id", configIds)
        .in("status", ["pending", "processing"])
        .lt("updated_at", stuckCutoff);

      if (stuckErr) throw new Error(stuckErr.message);
      const rows = stuckRows || [];
      if (rows.length === 0) {
        toast.success("No stuck jobs — queue looks healthy.");
        return;
      }

      // 3. Reset them. Preserve batch_index so we resume where we stopped.
      const { error: updErr } = await supabase
        .from("company_batch_queue")
        .update({
          status: "pending",
          is_cancelled: false,
          retry_count: 0,
          error_log: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", rows.map((r: any) => r.id));

      if (updErr) throw new Error(updErr.message);

      // 4. Kick processor once per unique config. Fire-and-forget; the
      //    processor self-chains from there.
      const uniqueConfigIds = [...new Set(rows.map((r: any) => r.config_id))];
      await Promise.all(
        uniqueConfigIds.map((cid) =>
          supabase.functions.invoke("process-company-batch-queue", {
            body: { configId: cid },
          }),
        ),
      );

      toast.success(
        `Resumed ${rows.length} stuck job${rows.length === 1 ? "" : "s"} across ${uniqueConfigIds.length} config${uniqueConfigIds.length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      toast.error(`Resume failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleResume} disabled={running}>
      {running ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <RotateCcw className="h-4 w-4 mr-2" />
      )}
      {running ? "Resuming..." : "Resume stuck jobs"}
    </Button>
  );
};
