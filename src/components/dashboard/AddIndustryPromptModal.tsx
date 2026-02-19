import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { addCustomPrompts } from '@/services/promptManagement';
import { toast } from 'sonner';
import { Loader2, X, Plus } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import type { RefreshProgress } from '@/hooks/useRefreshPrompts';

function getCountryDisplayName(code: string | null | undefined): string {
  if (!code || code === 'GLOBAL') return 'Global';
  const names: Record<string, string> = {
    US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
    DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands',
    PL: 'Poland', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden',
    NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland', PT: 'Portugal',
    GR: 'Greece', CZ: 'Czech Republic', HU: 'Hungary', RO: 'Romania', JP: 'Japan',
    CN: 'China', KR: 'South Korea', IN: 'India', SG: 'Singapore', MX: 'Mexico',
    BR: 'Brazil', AE: 'United Arab Emirates', SA: 'Saudi Arabia', TR: 'Turkey',
  };
  return names[code] ?? code;
}

function getVariantLabel(type: PromptVariant): string {
  switch (type) {
    case 'industry': return 'Industry';
    case 'job-function': return 'Job Function';
    case 'location': return 'Location';
  }
}

function getVariantColor(type: PromptVariant): string {
  switch (type) {
    case 'industry': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'job-function': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'location': return 'bg-green-50 text-green-700 border-green-200';
  }
}

interface AddIndustryPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  existingIndustries: string[];
  existingJobFunctions: string[];
  existingLocations: string[];
  onPromptsAdded: () => void;
  onRefreshPrompts: (promptIds: string[], companyName: string) => Promise<void>;
  isRefreshing: boolean;
  refreshProgress: RefreshProgress | null;
  selectedLocation?: string | null;
}

type PromptVariant = 'industry' | 'job-function' | 'location';

interface QueuedVariant {
  type: PromptVariant;
  value: string;
}

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
  existingJobFunctions,
  existingLocations,
  onPromptsAdded,
  onRefreshPrompts,
  isRefreshing,
  refreshProgress,
  selectedLocation,
}: AddIndustryPromptModalProps) => {
  const [mode, setMode] = useState<PromptVariant>('industry');
  const [industryInput, setIndustryInput] = useState('');
  const [jobFunctionInput, setJobFunctionInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestedIndustries, setSuggestedIndustries] = useState<string[]>([]);
  const [suggestedJobFunctions, setSuggestedJobFunctions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedVariant[]>([]);
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
    setQueue([]);
    fetchSuggestions();
  }, [isOpen]);

  const fetchSuggestions = async () => {
    try {
      setIsLoadingSuggestions(true);

      // Get all company IDs in the same organization (siblings + self)
      let orgCompanyIds: string[] = [companyId];

      const { data: orgLink } = await supabase
        .from('organization_companies')
        .select('organization_id')
        .eq('company_id', companyId)
        .maybeSingle();

      if (orgLink?.organization_id) {
        const { data: siblingCompanies } = await supabase
          .from('organization_companies')
          .select('company_id')
          .eq('organization_id', orgLink.organization_id);

        if (siblingCompanies && siblingCompanies.length > 0) {
          orgCompanyIds = siblingCompanies.map(sc => sc.company_id);
        }
      }

      const [industriesFromCompanies, industriesFromMappings, jobFunctionsFromPrompts] = await Promise.all([
        supabase.from('companies').select('industry').not('industry', 'is', null),
        supabase.from('company_industries').select('industry').not('industry', 'is', null),
        supabase
          .from('confirmed_prompts')
          .select('job_function_context')
          .not('job_function_context', 'is', null)
          .in('company_id', orgCompanyIds),
      ]);

      // Industries
      const collectedIndustries = new Set<string>();
      industriesFromCompanies.data?.forEach(entry => {
        if (entry.industry) collectedIndustries.add(entry.industry);
      });
      industriesFromMappings.data?.forEach(entry => {
        if (entry.industry) collectedIndustries.add(entry.industry);
      });
      setSuggestedIndustries(Array.from(collectedIndustries).sort((a, b) => a.localeCompare(b)));

      // Job functions — from confirmed_prompts scoped to org companies
      const collectedJobFunctions = new Set<string>();
      jobFunctionsFromPrompts.data?.forEach(entry => {
        if (entry.job_function_context) collectedJobFunctions.add(entry.job_function_context);
      });
      setSuggestedJobFunctions(Array.from(collectedJobFunctions).sort((a, b) => a.localeCompare(b)));
    } catch (fetchError) {
      console.error('Failed to load suggestions:', fetchError);
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

  const getCurrentInputValue = (): string => {
    switch (mode) {
      case 'industry': return industryInput;
      case 'job-function': return jobFunctionInput;
      case 'location': return locationInput;
    }
  };

  const clearCurrentInput = () => {
    switch (mode) {
      case 'industry': setIndustryInput(''); break;
      case 'job-function': setJobFunctionInput(''); break;
      case 'location': setLocationInput(''); break;
    }
  };

  const isAlreadyQueued = (type: PromptVariant, value: string): boolean => {
    return queue.some(
      item => item.type === type && item.value.toLowerCase() === value.toLowerCase()
    );
  };

  const addToQueue = () => {
    setError(null);

    if (!isPro && (mode === 'job-function' || mode === 'location')) {
      toast.error('Upgrade to Pro to add job function or location prompts.');
      return;
    }

    const trimmedValue = getCurrentInputValue().trim();

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

    if (isAlreadyQueued(mode, trimmedValue)) {
      setError(`"${trimmedValue}" is already in the queue.`);
      return;
    }

    setQueue(prev => [...prev, { type: mode, value: trimmedValue }]);
    clearCurrentInput();
    setError(null);
  };

  const removeFromQueue = (index: number) => {
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddOrSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedValue = getCurrentInputValue().trim();

    // If there's text in the input, add it to the queue first
    if (trimmedValue) {
      setError(null);

      if (!isPro && (mode === 'job-function' || mode === 'location')) {
        toast.error('Upgrade to Pro to add job function or location prompts.');
        return;
      }

      if (
        mode === 'industry' &&
        normalizedExistingIndustries.includes(trimmedValue.toLowerCase())
      ) {
        setError('Prompts already exist for this industry.');
        return;
      }

      if (isAlreadyQueued(mode, trimmedValue)) {
        setError(`"${trimmedValue}" is already in the queue.`);
        return;
      }

      const newQueue = [...queue, { type: mode, value: trimmedValue }];
      setQueue(newQueue);
      clearCurrentInput();
      setError(null);

      // Open confirm with the updated queue
      setIsConfirmOpen(true);
      return;
    }

    // No text in input — submit whatever is in the queue
    if (queue.length === 0) {
      setError('Add at least one item before collecting.');
      return;
    }

    setIsConfirmOpen(true);
  };

  const doActualSubmit = async () => {
    const itemsToSubmit = queue;
    if (itemsToSubmit.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;

      const userId = authData?.session?.user?.id;
      if (!userId) throw new Error('You must be signed in to add prompts.');

      const allInsertedIds: string[] = [];
      let allExisted = true;

      for (const item of itemsToSubmit) {
        try {
          const result = await addCustomPrompts({
            companyId,
            companyName,
            userId,
            isProUser: isPro,
            variant: {
              type: item.type,
              value: item.value,
            },
            selectedLocation: item.type === 'job-function' || item.type === 'industry' ? selectedLocation : undefined,
          });

          if (!result.alreadyExists) {
            allExisted = false;
          }

          allInsertedIds.push(...result.insertedPromptIds);
        } catch (variantError: any) {
          console.error(`Failed to add prompts for ${item.type}: ${item.value}`, variantError);
          // Continue with remaining variants instead of aborting everything
          toast.error(`Failed to add ${getVariantLabel(item.type)} "${item.value}": ${variantError.message}`);
        }
      }

      if (allExisted && allInsertedIds.length === 0) {
        toast.info('All prompts already exist. Try refreshing to see the latest responses.');
        setIsConfirmOpen(false);
        setQueue([]);
        onPromptsAdded();
        onClose();
      } else {
        const count = allInsertedIds.length;
        toast.success(`Added ${count} new prompt${count === 1 ? '' : 's'} across ${itemsToSubmit.length} variant${itemsToSubmit.length === 1 ? '' : 's'}. Collecting responses now...`);

        // Close the confirmation dialog so the main modal's progress bar is visible
        setIsConfirmOpen(false);
        setIsSubmitting(false);

        if (allInsertedIds.length > 0) {
          try {
            await onRefreshPrompts(allInsertedIds, companyName);
          } catch (refreshError: any) {
            console.error('Failed to refresh prompts after addition:', refreshError);
            toast.error('Prompts were created, but automatic data collection failed. Please use "Refresh Prompts" manually.');
          }
        }

        setQueue([]);
        onPromptsAdded();
        onClose();
      }
    } catch (submitError: any) {
      console.error('Failed to add prompts:', submitError);
      setError(submitError.message || 'Failed to add prompts. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const countryLabel =
    selectedLocation && selectedLocation !== 'GLOBAL'
      ? getCountryDisplayName(selectedLocation)
      : null;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add prompts</DialogTitle>
          <DialogDescription>
            Create additional monitoring prompts for {companyName}. Add multiple industries, job functions, or locations — then collect them all at once.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAddOrSubmit} className="space-y-6">
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
                <div className="flex gap-2">
                  <Input
                    id="industry"
                    placeholder="e.g. Technology"
                    value={industryInput}
                    onChange={event => {
                      setIndustryInput(event.target.value);
                      setError(null);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addToQueue}
                    disabled={!industryInput.trim()}
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
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
                      .filter(option => !isAlreadyQueued('industry', option))
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
            <>
              <div className="space-y-2">
                <Label htmlFor="jobFunction">Job function</Label>
                <div className="flex gap-2">
                  <Input
                    id="jobFunction"
                    placeholder="e.g. Software Engineers"
                    value={jobFunctionInput}
                    onChange={event => {
                      setJobFunctionInput(event.target.value);
                      setError(null);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addToQueue}
                    disabled={!jobFunctionInput.trim()}
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  We'll generate the full prompt library tailored to this role (Employer, Discovery, Comparison, and Employee Experience themes).
                </p>
              </div>

              {existingJobFunctions.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-gray-700">Current job functions</Label>
                  <div className="flex flex-wrap gap-2">
                    {existingJobFunctions.map(fn => (
                      <span key={fn} className="rounded-full bg-purple-50 border border-purple-200 px-3 py-1 text-xs font-medium text-purple-700">
                        {fn}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const suggestions = suggestedJobFunctions
                  .filter(option => !existingJobFunctions.some(fn => fn.toLowerCase() === option.toLowerCase()))
                  .filter(option => !isAlreadyQueued('job-function', option));

                if (isLoadingSuggestions || suggestions.length > 0) {
                  return (
                    <div className="space-y-2">
                      <Label className="text-sm text-gray-700">Suggestions</Label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {isLoadingSuggestions ? (
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading suggestions…
                          </div>
                        ) : (
                          suggestions.map(option => (
                            <Button
                              key={option}
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                if (!isAlreadyQueued('job-function', option)) {
                                  setQueue(prev => [...prev, { type: 'job-function', value: option }]);
                                }
                              }}
                            >
                              {option}
                            </Button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </>
          )}

          {mode === 'location' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <div className="flex gap-2">
                  <Input
                    id="location"
                    placeholder="e.g. Toronto, Canada or EMEA"
                    value={locationInput}
                    onChange={event => {
                      setLocationInput(event.target.value);
                      setError(null);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addToQueue}
                    disabled={!locationInput.trim()}
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Use any description (city, region, country). We'll apply it across the full prompt library.
                </p>
              </div>

              {existingLocations.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-gray-700">Current locations</Label>
                  <div className="flex flex-wrap gap-2">
                    {existingLocations.map(loc => (
                      <span key={loc} className="rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-medium text-green-700">
                        {loc}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Queued variants */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-gray-700">
                Queued ({queue.length} item{queue.length === 1 ? '' : 's'})
              </Label>
              <div className="flex flex-wrap gap-2">
                {queue.map((item, index) => (
                  <span
                    key={`${item.type}-${item.value}-${index}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${getVariantColor(item.type)}`}
                  >
                    <span className="opacity-60">{getVariantLabel(item.type)}:</span>
                    {item.value}
                    <button
                      type="button"
                      onClick={() => removeFromQueue(index)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
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
            <Button type="submit" disabled={isSubmitting || isRefreshing || (queue.length === 0 && !getCurrentInputValue().trim())}>
              {(isSubmitting || isRefreshing) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isRefreshing ? 'Collecting responses…' : 'Adding…'}
                </>
              ) : (
                `Collect ${queue.length > 0 ? queue.length : 1} variant${(queue.length > 1) ? 's' : ''}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={isConfirmOpen}
      onOpenChange={open => {
        setIsConfirmOpen(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm collection</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Are you sure you want to collect prompts for the following {queue.length} item{queue.length === 1 ? '' : 's'}?
                {countryLabel && <span> (location filter: {countryLabel})</span>}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {queue.map((item, index) => (
                  <li key={`${item.type}-${item.value}-${index}`}>
                    <span className="font-medium">{getVariantLabel(item.type)}:</span> {item.value}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={e => {
              e.preventDefault();
              doActualSubmit();
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              `Yes, collect ${queue.length} variant${queue.length === 1 ? '' : 's'}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
};
