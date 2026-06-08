import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCompany } from '@/contexts/CompanyContext';
import { getCountryFlag } from '@/utils/countryFlags';
import { getCountryName, countryToLocation, GLOBAL_LIKE } from '@/utils/locations';
import { Globe, ChevronDown, Check, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationFilterProps {
  selectedLocation: string | null;
  onLocationChange: (location: string | null) => void;
  // For companies whose locations live in confirmed_prompts.location_context
  // (e.g. Netflix Animation Studios → Burbank). null = all of the company's
  // locations combined.
  selectedLocationContext?: string | null;
  onLocationContextChange?: (locationContext: string | null) => void;
  className?: string;
}

export const LocationFilter = ({ selectedLocation, onLocationChange, selectedLocationContext = null, onLocationContextChange, className }: LocationFilterProps) => {
  const { currentCompany, userCompanies, switchCompany, companyLocationContexts, loading } = useCompany();
  const [isOpen, setIsOpen] = useState(false);

  // Some companies express their locations as free-text `location_context`
  // values on their prompts (cities, regions) rather than as separate
  // per-country records. When the current company is one of these, the filter
  // lists those contexts instead of countries.
  const currentContexts = useMemo(() => {
    if (loading || !currentCompany) return [] as string[];
    return companyLocationContexts[currentCompany.id] ?? [];
  }, [companyLocationContexts, currentCompany, loading]);
  const isContextCompany = currentContexts.length > 1;

  // The location filter is scoped to the CURRENT company: it switches between
  // the country-variants of the company you're already viewing (e.g. Netflix
  // US ↔ Netflix Japan), never to a different company. To view another
  // company's location, use the company switcher (which lists every company and
  // lets you pick a location per company).
  const sameNameCompanies = useMemo(() => {
    if (loading || !currentCompany) return [];
    const nameLower = currentCompany.name.toLowerCase();
    return userCompanies.filter(c => c.name.toLowerCase() === nameLower);
  }, [userCompanies, currentCompany, loading]);

  // Get unique countries for the current company.
  const availableLocations = useMemo(() => {
    if (loading) {
      return [];
    }

    const locations = new Set<string>();

    // Treat any country-agnostic variants as the same as the top-level
    // "Global" sentinel — selecting that already shows all locations combined,
    // so we don't render a separate row for them.
    sameNameCompanies.forEach(company => {
      const country = company.country || 'GLOBAL';
      if (!GLOBAL_LIKE.has(country)) {
        locations.add(country);
      }
    });

    // Sort locations alphabetically
    return Array.from(locations).sort((a, b) => {
      return getCountryName(a).localeCompare(getCountryName(b));
    });
  }, [sameNameCompanies, loading]);

  // Only show the "Global" entry if the current company has a global variant
  // (i.e. one with country null/empty or one of the GLOBAL_LIKE variants).
  const hasGlobalCompany = useMemo(() => {
    if (loading) return false;
    return sameNameCompanies.some(company => {
      const country = company.country;
      return !country || GLOBAL_LIKE.has(country);
    });
  }, [sameNameCompanies, loading]);

  // Keep `selectedLocation` aligned with the active company. The company is the
  // source of truth (its `country` is what the dashboard data is keyed to); the
  // location filter just reflects which country-variant of that company you're
  // viewing, never a different company.
  //
  //  - A starred location restored on load is honored only if the current
  //    company has a variant there (switch to that variant); otherwise we fall
  //    back to the company's own location so the flag and data never disagree.
  //  - With no starred location (fresh sign-in), prefer the company's US variant
  //    if it has one, else mirror the company's own location.
  useEffect(() => {
    if (loading || !currentCompany) return;

    const companyLocation = countryToLocation(currentCompany.country);

    if (selectedLocation) {
      if (selectedLocation === companyLocation) return; // already aligned

      const currentName = currentCompany.name.toLowerCase();
      const variant = userCompanies.find(
        c => c.name.toLowerCase() === currentName && countryToLocation(c.country) === selectedLocation
      );

      if (variant) {
        // Current company has this location — focus its variant there.
        if (variant.id !== currentCompany.id) {
          switchCompany(variant.id).catch(err => console.error('Failed to sync company with location:', err));
        }
      } else {
        // Not a location this company has — mirror the company instead.
        onLocationChange(companyLocation);
      }
      return;
    }

    // No location selected yet — default to US for this company if available.
    if (availableLocations.includes('US')) {
      onLocationChange('US');
    } else if (companyLocation !== null) {
      onLocationChange(companyLocation);
    }
  }, [loading, selectedLocation, availableLocations, onLocationChange, currentCompany, userCompanies, switchCompany]);

  // Drop a stale city focus when it doesn't belong to the current company (e.g.
  // after switching from Netflix Animation Studios to another company).
  useEffect(() => {
    if (loading || !currentCompany) return;
    if (selectedLocationContext && !currentContexts.includes(selectedLocationContext)) {
      onLocationContextChange?.(null);
    }
  }, [loading, currentCompany, currentContexts, selectedLocationContext, onLocationContextChange]);

  // Only hide if this company has nothing to show: no country locations, no
  // global variant to label, and no city contexts.
  if (availableLocations.length === 0 && !hasGlobalCompany && !isContextCompany) {
    return null;
  }

  // Focus the dashboard on one of the current company's location_context cities
  // (or all of them when null). No company switch — same company, narrower view.
  const handleContextSelect = (locationContext: string | null) => {
    onLocationChange(null);
    onLocationContextChange?.(locationContext);
    setIsOpen(false);
  };

  const handleLocationSelect = async (location: string | null) => {
    // Update the location filter state
    onLocationChange(location);
    setIsOpen(false);

    // If no location selected (Global), try to find a company with the same name as current
    // Otherwise, switch to a company matching the current name in the selected location
    if (!currentCompany) return;

    const targetLocation = location || 'GLOBAL';
    const currentCompanyName = currentCompany.name.toLowerCase();

    // Switch to the same company in the target location. The dropdown only
    // offers locations this company actually has, so this resolves; we never
    // fall back to a different company just because it operates there.
    let targetCompany = userCompanies.find(company => {
      const companyName = company.name.toLowerCase();
      const companyCountry = company.country || 'GLOBAL';
      return companyName === currentCompanyName && companyCountry === targetLocation;
    });

    // Global may not have an exact GLOBAL-coded row; accept any country-agnostic
    // variant of the same company.
    if (!targetCompany && !location) {
      targetCompany = userCompanies.find(company => {
        const companyName = company.name.toLowerCase();
        const companyCountry = company.country || 'GLOBAL';
        return companyName === currentCompanyName && GLOBAL_LIKE.has(companyCountry);
      });
    }

    // Switch to the target company if found and different from current
    if (targetCompany && targetCompany.id !== currentCompany.id) {
      try {
        await switchCompany(targetCompany.id);
      } catch (error) {
        console.error('Failed to switch company:', error);
      }
    }
  };

  // The trigger reflects the active focus: a chosen city, a country flag, or
  // "All locations"/"Global".
  const displayName = selectedLocationContext
    ? selectedLocationContext
    : isContextCompany
      ? 'All locations'
      : selectedLocation
        ? getCountryName(selectedLocation)
        : 'Global';
  const displayIcon = selectedLocationContext ? (
    <MapPin className="h-4 w-4 text-gray-500" />
  ) : selectedLocation ? (
    <span className="text-base leading-none">{getCountryFlag(selectedLocation)}</span>
  ) : (
    <Globe className="h-4 w-4" />
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'flex items-center gap-2 justify-between min-w-[140px] sm:min-w-[160px]',
            className
          )}
        >
          <div className="flex items-center gap-2">
            {displayIcon}
            <span className="font-medium truncate max-w-[100px] sm:max-w-[120px] text-xs sm:text-sm">
              {displayName}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuLabel>
          {isContextCompany || availableLocations.length > 0 ? 'Filter by Location' : 'Locations'}
        </DropdownMenuLabel>
        {isContextCompany ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleContextSelect(null)}
              className="cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                {!selectedLocationContext ? (
                  <Check className="h-4 w-4 text-[#13274F]" />
                ) : (
                  <div className="h-4 w-4" />
                )}
                <Globe className="h-4 w-4" />
                <span className={cn(
                  'text-sm',
                  !selectedLocationContext && 'font-semibold text-[#13274F]'
                )}>
                  All locations
                </span>
              </div>
            </DropdownMenuItem>
            {currentContexts.map(ctx => {
              const isSelected = selectedLocationContext === ctx;
              return (
                <DropdownMenuItem
                  key={ctx}
                  onClick={() => handleContextSelect(ctx)}
                  className="cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {isSelected ? <Check className="h-4 w-4 text-[#13274F]" /> : <div className="h-4 w-4" />}
                    <MapPin className="h-4 w-4 text-gray-500" />
                    <span className={cn(
                      'text-sm',
                      isSelected && 'font-semibold text-[#13274F]'
                    )}>
                      {ctx}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </>
        ) : (availableLocations.length > 0 || hasGlobalCompany) && (
          <>
            <DropdownMenuSeparator />
            {hasGlobalCompany && (
              <DropdownMenuItem
                onClick={() => handleLocationSelect(null)}
                className="cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  {!selectedLocation ? (
                    <Check className="h-4 w-4 text-[#13274F]" />
                  ) : (
                    <div className="h-4 w-4" />
                  )}
                  <Globe className="h-4 w-4" />
                  <span className={cn(
                    'text-sm',
                    !selectedLocation && 'font-semibold text-[#13274F]'
                  )}>
                    Global
                  </span>
                </div>
              </DropdownMenuItem>
            )}
            {availableLocations.map(location => {
              const isSelected = selectedLocation === location;
              const locationName = getCountryName(location);
              const locationFlag = location !== 'GLOBAL' ? getCountryFlag(location) : null;

              return (
                <DropdownMenuItem
                  key={location}
                  onClick={() => handleLocationSelect(location)}
                  className="cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {isSelected && <Check className="h-4 w-4 text-[#13274F]" />}
                    {!isSelected && <div className="h-4 w-4" />}
                    {locationFlag ? (
                      <span className="text-base leading-none">{locationFlag}</span>
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                    <span className={cn(
                      'text-sm',
                      isSelected && 'font-semibold text-[#13274F]'
                    )}>
                      {locationName}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

