import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { addCustomPrompts } from '@/services/promptManagement';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import type { RefreshProgress } from '@/hooks/useRefreshPrompts';

interface AddIndustryPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  existingIndustries: string[];
  onPromptsAdded: () => void;
  onRefreshPrompts: (promptIds: string[], companyName: string) => Promise<void>;
  isRefreshing: boolean;
  refreshProgress: RefreshProgress | null;
}

type PromptVariant = 'industry' | 'job-function' | 'location';

const JOB_FUNCTION_OPTIONS = [
  'Software Engineers',
  'Product Managers',
  'Designers',
  'Data Scientists',
  'Sales Professionals',
  'Customer Support',
  'Marketing Specialists',
  'Human Resources',
  'Finance Professionals',
  'Operations Managers',
];

const VARIANT_OPTIONS: Array<{
  id: PromptVariant;
  label: string;
  description: string;
  proOnly?: boolean;
}> = [
  {
    id: 'industry',
    label: 'Industry',
    description: 'Benchmark against a different industry (e.g. Fintech, Healthcare).',
  },
  {
    id: 'job-function',
    label: 'Job Function',
    description: 'Focus prompts on a specific role (e.g. Software Engineers).',
    proOnly: true,
  },
  {
    id: 'location',
    label: 'Location',
    description: 'Compare sentiment for a particular location (e.g. Toronto, UK).',
    proOnly: true,
  },
];

export const AddIndustryPromptModal = ({
  isOpen,
  onClose,
  companyId,
  companyName,
  existingIndustries,
  onPromptsAdded,
  onRefreshPrompts,
  isRefreshing,
  refreshProgress,
}: AddIndustryPromptModalProps) => {
  const [mode, setMode] = useState<PromptVariant>('industry');
  const [industryInput, setIndustryInput] = useState('');
  const [jobFunctionInput, setJobFunctionInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestedIndustries, setSuggestedIndustries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { isPro } = useSubscription();

  const normalizedExistingIndustries = useMemo(
    () => existingIndustries.map(industry => industry.toLowerCase()),
    [existingIndustries]
  );

  useEffect(() => {
    if (!isOpen) return;

    setMode('industry');
    setIndustryInput('');
    setJobFunctionInput('');
    setLocationInput('');
    setError(null);
    fetchIndustrySuggestions();
  }, [isOpen]);

  const fetchIndustrySuggestions = async () => {
    try {
      setIsLoadingSuggestions(true);

      const [industriesFromCompanies, industriesFromMappings] = await Promise.all([
        supabase.from('companies').select('industry').not('industry', 'is', null),
        supabase.from('company_industries').select('industry').not('industry', 'is', null),
      ]);

      const collected = new Set<string>();

      industriesFromCompanies.data?.forEach(entry => {
        if (entry.industry) collected.add(entry.industry);
      });

      industriesFromMappings.data?.forEach(entry => {
        if (entry.industry) collected.add(entry.industry);
      });

      const sorted = Array.from(collected).sort((a, b) => a.localeCompare(b));
      setSuggestedIndustries(sorted);
    } catch (fetchError) {
      console.error('Failed to load industry suggestions:', fetchError);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleModeChange = (newMode: PromptVariant) => {
    if (!isPro && (newMode === 'job-function' || newMode === 'location')) {
      toast.error('Upgrade to Pro to add job function or location prompts.');
      return;
    }

    setMode(newMode);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!isPro && (mode === 'job-function' || mode === 'location')) {
      toast.error('Upgrade to Pro to add job function or location prompts.');
      return;
    }

    const rawValue =
      mode === 'industry'
        ? industryInput
        : mode === 'job-function'
          ? jobFunctionInput
          : locationInput;

    const trimmedValue = rawValue.trim();

    if (!trimmedValue) {
      setError(`Please enter a ${mode === 'industry' ? 'value' : mode === 'job-function' ? 'job function' : 'location'}.`);
      return;
    }

    if (
      mode === 'industry' &&
      normalizedExistingIndustries.includes(trimmedValue.toLowerCase())
    ) {
      setError('Prompts already exist for this industry.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;

      const userId = authData?.session?.user?.id;
      if (!userId) throw new Error('You must be signed in to add prompts.');

      const result = await addCustomPrompts({
        companyId,
        companyName,
        userId,
        isProUser: isPro,
        variant: {
          type: mode,
          value: trimmedValue,
        },
      });

      if (result.alreadyExists) {
        toast.info('Prompts with this context already exist. Try refreshing to see the latest responses.');
      } else {
        toast.success(`Added ${result.insertedPromptIds.length} new prompt${result.insertedPromptIds.length === 1 ? '' : 's'}. Collecting responses now...`);

        if (result.insertedPromptIds.length > 0) {
          try {
            await onRefreshPrompts(result.insertedPromptIds, companyName);
          } catch (refreshError: any) {
            console.error('Failed to refresh prompts after addition:', refreshError);
            toast.error('Prompts were created, but automatic data collection failed. Please use "Refresh Prompts" manually.');
          }
        }
      }

      onPromptsAdded();
      onClose();
    } catch (submitError: any) {
      console.error('Failed to add prompts:', submitError);
      setError(submitError.message || 'Failed to add prompts. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add prompts</DialogTitle>
          <DialogDescription>
            Create additional monitoring prompts for {companyName}. Choose whether to focus on a new industry, job function, or location.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label>What would you like to add prompts for?</Label>
            <div className="flex flex-wrap gap-2">
              {VARIANT_OPTIONS.map(option => {
                const disabled = option.proOnly && !isPro;
                const isSelected = mode === option.id;

                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    disabled={disabled}
                    onClick={() => handleModeChange(option.id)}
                  >
                    {option.label}
                    {option.proOnly && (
                      <span className="ml-2 rounded-full bg-gray-900/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-700">
                        Pro
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">
              {VARIANT_OPTIONS.find(option => option.id === mode)?.description}
            </p>
          </div>

          {mode === 'industry' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  placeholder="e.g. Technology"
                  value={industryInput}
                  onChange={event => {
                    setIndustryInput(event.target.value);
                    setError(null);
                  }}
                />
                <p className="text-xs text-gray-500">
                  We will generate the full Employer, Discovery, Comparison, and Employee Experience prompt set for this industry.
                </p>
              </div>

              {existingIndustries.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-gray-700">Current industries</Label>
                  <div className="flex flex-wrap gap-2">
                    {existingIndustries.map(industry => (
                      <span key={industry} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {industry}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm text-gray-700">Suggestions</Label>
                <div className="flex flex-wrap gap-2">
                  {isLoadingSuggestions ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading suggestions…
                    </div>
                  ) : (
                    suggestedIndustries
                      .filter(option => !normalizedExistingIndustries.includes(option.toLowerCase()))
                      .slice(0, 12)
                      .map(option => (
                        <Button
                          key={option}
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setIndustryInput(option);
                            setError(null);
                          }}
                        >
                          {option}
                        </Button>
                      ))
                  )}
                  {!isLoadingSuggestions && suggestedIndustries.length === 0 && (
                    <span className="text-sm text-gray-500">No suggestions available yet.</span>
                  )}
                </div>
              </div>
            </>
          )}

          {mode === 'job-function' && (
            <div className="space-y-2">
              <Label htmlFor="jobFunction">Job function</Label>
              <Input
                id="jobFunction"
                placeholder="e.g. Software Engineers"
                value={jobFunctionInput}
                onChange={event => {
                  setJobFunctionInput(event.target.value);
                  setError(null);
                }}
              />
              <p className="text-xs text-gray-500">
                We’ll generate the full prompt library tailored to this role (Employer, Discovery, Comparison, and Employee Experience themes).
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {JOB_FUNCTION_OPTIONS.map(option => (
                  <Button
                    key={option}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setJobFunctionInput(option);
                      setError(null);
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {mode === 'location' && (
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="e.g. Toronto, Canada or EMEA"
                value={locationInput}
                onChange={event => {
                  setLocationInput(event.target.value);
                  setError(null);
                }}
              />
              <p className="text-xs text-gray-500">
                Use any description (city, region, country). We’ll apply it across the full prompt library.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {isRefreshing && refreshProgress && (
            <div className="rounded-md bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border border-blue-200/50">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      We're collecting data about {companyName}
                    </span>
                    {refreshProgress.total > 0 && (
                      <>
                        <span className="text-sm text-gray-600">
                          • {Math.round(((refreshProgress.total - refreshProgress.completed) / refreshProgress.total) * 100)}% remaining
                        </span>
                        {refreshProgress.completed > 0 && refreshProgress.total > refreshProgress.completed && (
                          <span className="text-xs text-gray-500">
                            (est. {Math.ceil(((refreshProgress.total - refreshProgress.completed) * 2.5) / 60)} min)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting || isRefreshing}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isRefreshing}>
              {(isSubmitting || isRefreshing) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isRefreshing ? 'Collecting responses…' : 'Adding…'}
                </>
              ) : (
                'Add prompts'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

