import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Play, Loader2, RefreshCw, Database } from 'lucide-react';
import { useAdminCompanyCollection } from '@/hooks/useAdminCompanyCollection';
import { EXPECTED_MODELS_PER_PROMPT } from '@/utils/collectionCoverage';

interface PromptWithCount {
  id: string;
  prompt_text: string;
  prompt_type: string;
  prompt_category: string;
  prompt_theme: string;
  response_count: number;
  is_complete: boolean;
}

interface CompanyCollectionTabProps {
  companyId: string;
  companyName: string;
  organizationId: string;
  onUpdate: () => void;
}

export const CompanyCollectionTab = ({
  companyId,
  companyName,
  organizationId,
  onUpdate,
}: CompanyCollectionTabProps) => {
  const [prompts, setPrompts] = useState<PromptWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const { runContinueCollection, isRunning } = useAdminCompanyCollection();

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    try {
      const { data: promptsData, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id, prompt_text, prompt_type, prompt_category, prompt_theme')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('prompt_category')
        .order('prompt_theme')
        .order('prompt_type');

      if (promptsError) throw promptsError;
      if (!promptsData?.length) {
        setPrompts([]);
        return;
      }

      const { data: responsesData, error: responsesError } = await supabase
        .from('prompt_responses')
        .select('confirmed_prompt_id')
        .eq('company_id', companyId);

      if (responsesError) throw responsesError;

      const countByPrompt = new Map<string, number>();
      (responsesData || []).forEach((r) => {
        if (r.confirmed_prompt_id) {
          countByPrompt.set(
            r.confirmed_prompt_id,
            (countByPrompt.get(r.confirmed_prompt_id) ?? 0) + 1
          );
        }
      });

      const promptsWithCount: PromptWithCount[] = promptsData.map((p) => {
        const count = countByPrompt.get(p.id) ?? 0;
        return {
          ...p,
          response_count: count,
          is_complete: count >= EXPECTED_MODELS_PER_PROMPT,
        };
      });

      setPrompts(promptsWithCount);
    } catch (e) {
      console.error('Error loading collection coverage:', e);
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  const handleContinueCollection = async () => {
    const ok = await runContinueCollection(companyId, organizationId, companyName);
    if (ok) {
      await loadCoverage();
      onUpdate();
    }
  };

  const completeCount = prompts.filter((p) => p.is_complete).length;
  const totalCount = prompts.length;
  const incompleteCount = totalCount - completeCount;
  const isFullyComplete = totalCount > 0 && completeCount === totalCount;

  if (loading) {
    return (
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Database className="h-4 w-4" />
                Collection Coverage
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Each prompt needs {EXPECTED_MODELS_PER_PROMPT} responses (one per AI model) to be complete.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={loadCoverage}
                variant="outline"
                size="sm"
                className="border-slate-200 text-slate-600 h-8"
                disabled={loading}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Refresh
              </Button>
              <Button
                onClick={handleContinueCollection}
                size="sm"
                className="bg-pink hover:bg-pink/90 text-white h-8"
                disabled={isRunning || (totalCount === 0)}
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Play className="h-3.5 w-3.5 mr-1" />
                )}
                Continue collection
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge
                variant={isFullyComplete ? 'default' : 'outline'}
                className="text-xs font-normal"
              >
                {completeCount}/{totalCount} prompts complete
              </Badge>
              {incompleteCount > 0 && (
                <span className="text-xs text-slate-500">
                  {incompleteCount} remaining
                </span>
              )}
            </div>
          </div>

          {prompts.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No active prompts for this company.</p>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Category</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Theme</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Type</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600 w-24">Responses</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prompts.map((p) => (
                    <TableRow key={p.id} className="border-slate-200">
                      <TableCell className="py-2 px-3 text-sm text-slate-700">
                        {p.prompt_category || '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-sm text-slate-700">
                        {p.prompt_theme || '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-slate-600">
                        {p.prompt_type}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-sm">
                        <span className={p.is_complete ? 'text-emerald-600 font-medium' : 'text-slate-600'}>
                          {p.response_count}/{EXPECTED_MODELS_PER_PROMPT}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge
                          variant={p.is_complete ? 'default' : 'outline'}
                          className="text-xs font-normal"
                        >
                          {p.is_complete ? 'Complete' : 'Incomplete'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
