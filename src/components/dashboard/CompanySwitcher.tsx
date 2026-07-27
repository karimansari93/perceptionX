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
import { Building2, Check, ChevronDown, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Favicon } from '@/components/ui/favicon';
import { getCountryFlag } from '@/utils/countryFlags';
import { getCountryName, countryToLocation } from '@/utils/locations';
import { canonicalizeLocationContext } from '@/utils/locationContext';

interface CompanySwitcherProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  alwaysMounted?: boolean;
  // Stash a location to apply right after the company switch lands, so the
  // location trigger reflects the picked country (see useDashboardData).
  onPendingLocationChange?: (location: string | null) => void;
}

// A selectable location for a company name: a country variant (its own company
// record). Companies sharing a name (e.g. "Netflix" in US and JP) are separate
// records grouped under one submenu.
type LocationOption = { kind: 'country'; company: Company; location: string | null };

export const CompanySwitcher = ({ className, variant = 'ghost', alwaysMounted = false, onPendingLocationChange }: CompanySwitcherProps) => {
  const { currentCompany, userCompanies, switchCompany, loading } = useCompany();
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

  const isCurrentOption = (opt: LocationOption) => opt.company.id === currentCompany?.id;

  // Switch to the company record the option represents. `pendingLocation` is
  // the canonical location key to land on after the switch:
  //  - submenu country picks pass the picked country (the user explicitly chose
  //    it, and multi-country brands store matching location_context spellings);
  //  - single-record brand clicks pass null ("All locations") — the user chose
  //    a COMPANY, not a country, and pinning the record's `country` field as a
  //    filter breaks companies whose prompts are tagged sub-nationally (e.g.
  //    Ford Energy: all data is "Kentucky"/"Dearborn, Michigan", so the seeded
  //    "United States" bucket is empty and rendered a false "No Data" view).
  const selectOption = async (opt: LocationOption, pendingLocation: string | null) => {
    setIsOpen(false);
    if (isCurrentOption(opt)) return;
    onPendingLocationChange?.(pendingLocation);
    try {
      await switchCompany(opt.company.id);
      toast.success('Company switched');
    } catch (error) {
      onPendingLocationChange?.(null);
      toast.error('Failed to switch company');
    }
  };

  // Show ALL companies, grouped by (name, organization) — the same brand-scope
  // rule the dashboard aggregates by. Grouping by name alone merged identical
  // brand names ACROSS client organizations, hiding all but one org's profile
  // behind the country dedupe below and letting a country click silently jump
  // organizations. Same-name groups in different orgs stay separate entries.
  const groups = Object.values(
    userCompanies.reduce((acc, company) => {
      const key = `${company.name.toLowerCase()}::${company.organization_id ?? ''}`;
      if (!acc[key]) {
        acc[key] = { key, name: company.name, companies: [] };
      }
      acc[key].companies.push(company);
      return acc;
    }, {} as Record<string, { key: string; name: string; companies: Company[] }>)
  ).sort((a, b) => a.name.localeCompare(b.name));

  const optionRank = (o: LocationOption) => (o.location === null ? 0 : 1);
  const optionLabel = (o: LocationOption) =>
    o.location ? getCountryName(o.location) : 'Global';

  const optionsFor = (companies: Company[]): LocationOption[] => {
    const byKey = new Map<string, LocationOption>();
    for (const company of companies) {
      const loc = countryToLocation(company.country);
      // Dedupe by country (null/GLOBAL collapses to one "Global" entry);
      // prefer the current company when two records share a country.
      const key = loc !== null ? `c:${loc}` : 'c:__global__';
      if (!byKey.has(key) || company.id === currentCompany?.id) {
        byKey.set(key, { kind: 'country', company, location: loc });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => {
      const r = optionRank(a) - optionRank(b);
      return r !== 0 ? r : optionLabel(a).localeCompare(optionLabel(b));
    });
  };

  const renderOptionIcon = (opt: LocationOption) => {
    const flag = opt.location ? getCountryFlag(opt.location) : '';
    return flag
      ? <span className="text-base leading-none">{flag}</span>
      : <Globe className="h-4 w-4" />;
  };

  const renderOptionItem = (opt: LocationOption) => {
    const isCurrent = isCurrentOption(opt);
    const key = `${opt.company.id}:country`;
    return (
      <DropdownMenuItem
        key={key}
        // Explicit country pick from the submenu: land on that country's view.
        onClick={() => selectOption(opt, canonicalizeLocationContext(opt.location))}
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
                  key={group.key}
                  // Brand click (no country submenu shown): land on "All
                  // locations" — the user didn't pick a country.
                  onClick={() => selectOption(opt, null)}
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
              <DropdownMenuSub key={group.key}>
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
