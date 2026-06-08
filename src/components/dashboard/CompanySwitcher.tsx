import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useCompany, type Company } from '@/contexts/CompanyContext';
import { Building2, Check, ChevronDown, Globe, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Favicon } from '@/components/ui/favicon';
import { getCountryFlag } from '@/utils/countryFlags';
import { getCountryName, countryToLocation } from '@/utils/locations';

interface CompanySwitcherProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  alwaysMounted?: boolean;
  // Switching to a company also focuses the dashboard on that company's
  // location. The header wires these to the shared location state so the
  // location filter, `market`-based hooks, and saved views stay in sync.
  onLocationChange?: (location: string | null) => void;
  // For companies whose locations live in confirmed_prompts.location_context
  // (e.g. Netflix Animation Studios → Burbank). null clears the city focus.
  onLocationContextChange?: (locationContext: string | null) => void;
  selectedLocationContext?: string | null;
}

// A selectable location for a company name: either a country variant (its own
// company record) or a `location_context` value within a single record.
type LocationOption =
  | { kind: 'country'; company: Company; location: string | null }
  | { kind: 'context'; company: Company; locationContext: string };

export const CompanySwitcher = ({ className, variant = 'ghost', alwaysMounted = false, onLocationChange, onLocationContextChange, selectedLocationContext }: CompanySwitcherProps) => {
  const { currentCompany, userCompanies, switchCompany, companyLocationContexts, loading } = useCompany();
  const [isOpen, setIsOpen] = useState(false);


  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
        <Building2 className="h-4 w-4 text-gray-400 animate-pulse" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  if (!currentCompany) {
    return null;
  }

  const getCompanyDomain = (companyName: string) => {
    // Convert "Netflix" -> "netflix.com", "T Rowe Price" -> "troweprice.com"
    return companyName.toLowerCase().replace(/\s+/g, '') + '.com';
  };

  const isCurrentOption = (opt: LocationOption) => {
    if (opt.company.id !== currentCompany?.id) return false;
    return opt.kind === 'context'
      ? opt.locationContext === selectedLocationContext
      : selectedLocationContext == null;
  };

  // Switch to the company record + location the option represents. A context
  // option may share the current company's id (just a different city), in which
  // case we change only the location focus, not the company.
  const selectOption = async (opt: LocationOption) => {
    setIsOpen(false);
    if (isCurrentOption(opt)) return;
    const companyChanged = opt.company.id !== currentCompany?.id;
    try {
      if (companyChanged) {
        await switchCompany(opt.company.id);
      }
      if (opt.kind === 'context') {
        onLocationChange?.(null);
        onLocationContextChange?.(opt.locationContext);
      } else {
        onLocationChange?.(opt.location);
        onLocationContextChange?.(null);
      }
      toast.success(companyChanged ? 'Company switched' : 'Location updated');
    } catch (error) {
      toast.error('Failed to switch company');
    }
  };

  // Show ALL companies, grouped by name. Each company's selectable locations are
  // either its country variants (separate records) or — for a null/GLOBAL-country
  // record whose prompts span multiple location_context values — those contexts
  // (e.g. Burbank / Sydney / Vancouver). >1 location → submenu; else direct item.
  const groups = Object.values(
    userCompanies.reduce((acc, company) => {
      const key = company.name.toLowerCase();
      if (!acc[key]) {
        acc[key] = { name: company.name, companies: [] };
      }
      acc[key].companies.push(company);
      return acc;
    }, {} as Record<string, { name: string; companies: Company[] }>)
  ).sort((a, b) => a.name.localeCompare(b.name));

  const optionRank = (o: LocationOption) =>
    o.kind === 'country' ? (o.location === null ? 0 : 1) : 2;
  const optionLabel = (o: LocationOption) =>
    o.kind === 'context' ? o.locationContext : (o.location ? getCountryName(o.location) : 'Global');

  const optionsFor = (companies: Company[]): LocationOption[] => {
    const byKey = new Map<string, LocationOption>();
    for (const company of companies) {
      const loc = countryToLocation(company.country);
      if (loc !== null) {
        // Per-country record. Dedupe by country; prefer the current company.
        const key = `c:${loc}`;
        if (!byKey.has(key) || company.id === currentCompany?.id) {
          byKey.set(key, { kind: 'country', company, location: loc });
        }
      } else {
        // Null/GLOBAL record: split into its prompt location_contexts if it has
        // more than one; otherwise it's a single "Global" entry.
        const contexts = companyLocationContexts[company.id] ?? [];
        if (contexts.length > 1) {
          for (const ctx of contexts) {
            byKey.set(`x:${company.id}:${ctx}`, { kind: 'context', company, locationContext: ctx });
          }
        } else {
          const key = 'c:__global__';
          if (!byKey.has(key) || company.id === currentCompany?.id) {
            byKey.set(key, { kind: 'country', company, location: null });
          }
        }
      }
    }
    return Array.from(byKey.values()).sort((a, b) => {
      const r = optionRank(a) - optionRank(b);
      return r !== 0 ? r : optionLabel(a).localeCompare(optionLabel(b));
    });
  };

  const renderOptionIcon = (opt: LocationOption) => {
    if (opt.kind === 'context') {
      return <MapPin className="h-4 w-4 text-gray-500" />;
    }
    const flag = opt.location ? getCountryFlag(opt.location) : '';
    return flag
      ? <span className="text-base leading-none">{flag}</span>
      : <Globe className="h-4 w-4" />;
  };

  const renderOptionItem = (opt: LocationOption) => {
    const isCurrent = isCurrentOption(opt);
    const key = opt.kind === 'context' ? `${opt.company.id}:${opt.locationContext}` : `${opt.company.id}:country`;
    return (
      <DropdownMenuItem
        key={key}
        onClick={() => selectOption(opt)}
        className="cursor-pointer flex items-center gap-2"
      >
        {isCurrent ? <Check className="h-4 w-4 text-[#13274F]" /> : <div className="h-4 w-4" />}
        {renderOptionIcon(opt)}
        <span className={cn('text-sm', isCurrent && 'font-semibold text-[#13274F]')}>
          {optionLabel(opt)}
        </span>
      </DropdownMenuItem>
    );
  };

  return (
    <>
    <DropdownMenu
      open={loading ? false : isOpen}
      onOpenChange={(open) => {
        if (!loading) {
          setIsOpen(open);
        }
      }}
      {...(alwaysMounted && { forceMount: true })}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          className={cn(
            'flex items-center gap-2 justify-between min-w-[200px] sm:min-w-[200px]',
            className
          )}
        >
          <div className="flex items-center gap-2">
            <Favicon domain={getCompanyDomain(currentCompany.name)} size="sm" />
            <span className="font-medium truncate max-w-[120px] sm:max-w-[150px]">
              {currentCompany.name}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[250px]">
        <DropdownMenuLabel>Your Companies</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <DropdownMenuItem disabled className="cursor-not-allowed">
            <div className="flex items-center gap-2 w-full">
              <Building2 className="h-4 w-4 text-gray-400 animate-pulse" />
              <span className="text-sm text-gray-500">Loading companies...</span>
            </div>
          </DropdownMenuItem>
        ) : (
          groups.map((group) => {
            const options = optionsFor(group.companies);

            // Single location: switch directly on click.
            if (options.length === 1) {
              const opt = options[0];
              const isCurrent = isCurrentOption(opt);
              return (
                <DropdownMenuItem
                  key={group.name.toLowerCase()}
                  onClick={() => selectOption(opt)}
                  className="cursor-pointer flex items-center gap-2"
                >
                  {isCurrent ? <Check className="h-4 w-4 text-[#13274F]" /> : <div className="h-4 w-4" />}
                  <Favicon domain={getCompanyDomain(group.name)} size="sm" />
                  <span className={cn('flex-1 text-sm', isCurrent && 'font-semibold text-[#13274F]')}>
                    {group.name}
                  </span>
                  {opt.kind === 'country' && opt.location && (
                    <span className="text-base leading-none">{getCountryFlag(opt.location)}</span>
                  )}
                </DropdownMenuItem>
              );
            }

            // Multiple locations: submenu, pick a location to focus on.
            const isCurrentGroup = group.companies.some((c) => c.id === currentCompany?.id);
            return (
              <DropdownMenuSub key={group.name.toLowerCase()}>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <div className="flex items-center gap-2 flex-1">
                    {isCurrentGroup ? <Check className="h-4 w-4 text-[#13274F]" /> : <div className="h-4 w-4" />}
                    <Favicon domain={getCompanyDomain(group.name)} size="sm" />
                    <span className={cn('text-sm', isCurrentGroup && 'font-semibold text-[#13274F]')}>
                      {group.name}
                    </span>
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[220px]">
                  {options.map(renderOptionItem)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
};
