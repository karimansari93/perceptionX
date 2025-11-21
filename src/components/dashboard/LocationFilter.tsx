import { useState, useMemo } from 'react';
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
import { Globe, ChevronDown, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// Country code to display name mapping (from AddCompanyModal)
const getCountryName = (code: string): string => {
  const countryNames: Record<string, string> = {
    'GLOBAL': 'Global',
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'IE': 'Ireland',
    'PT': 'Portugal',
    'GR': 'Greece',
    'PL': 'Poland',
    'CZ': 'Czech Republic',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
    'JP': 'Japan',
    'CN': 'China',
    'KR': 'South Korea',
    'IN': 'India',
    'SG': 'Singapore',
    'MY': 'Malaysia',
    'TH': 'Thailand',
    'PH': 'Philippines',
    'ID': 'Indonesia',
    'VN': 'Vietnam',
    'MX': 'Mexico',
    'BR': 'Brazil',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'AE': 'United Arab Emirates',
    'SA': 'Saudi Arabia',
    'ZA': 'South Africa',
    'NZ': 'New Zealand',
    'TR': 'Turkey',
    'RU': 'Russia',
  };
  return countryNames[code] || code;
};

interface LocationFilterProps {
  selectedLocation: string | null;
  onLocationChange: (location: string | null) => void;
  onAddLocation?: () => void;
  className?: string;
}

export const LocationFilter = ({ selectedLocation, onLocationChange, onAddLocation, className }: LocationFilterProps) => {
  const { currentCompany, userCompanies, switchCompany } = useCompany();
  const [isOpen, setIsOpen] = useState(false);

  // Get unique countries from user's companies
  const availableLocations = useMemo(() => {
    const locations = new Set<string>();
    
    userCompanies.forEach(company => {
      const country = company.country || 'GLOBAL';
      // Only add non-GLOBAL countries to the set
      if (country !== 'GLOBAL') {
        locations.add(country);
      }
    });
    
    // Sort locations alphabetically
    return Array.from(locations).sort((a, b) => {
      return getCountryName(a).localeCompare(getCountryName(b));
    });
  }, [userCompanies]);

  // Don't show filter if there are no locations (only GLOBAL)
  if (availableLocations.length === 0) {
    return null;
  }

  const handleLocationSelect = async (location: string | null) => {
    // Update the location filter state
    onLocationChange(location);
    setIsOpen(false);

    // If no location selected (Global), try to find a company with the same name as current
    // Otherwise, switch to a company matching the current name in the selected location
    if (!currentCompany) return;

    const targetLocation = location || 'GLOBAL';
    const currentCompanyName = currentCompany.name.toLowerCase();

    // First, try to find a company with the same name in the target location
    let targetCompany = userCompanies.find(company => {
      const companyName = company.name.toLowerCase();
      const companyCountry = company.country || 'GLOBAL';
      return companyName === currentCompanyName && companyCountry === targetLocation;
    });

    // If not found and location is not Global, try to find any company in that location
    if (!targetCompany && location) {
      targetCompany = userCompanies.find(company => {
        const companyCountry = company.country || 'GLOBAL';
        return companyCountry === targetLocation;
      });
    }

    // If still not found and location is null (Global), try to find any company with same name
    if (!targetCompany && !location) {
      targetCompany = userCompanies.find(company => {
        const companyName = company.name.toLowerCase();
        return companyName === currentCompanyName;
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

  const displayLocation = selectedLocation || 'GLOBAL';
  const displayName = selectedLocation ? getCountryName(selectedLocation) : 'Global';
  const displayIcon = selectedLocation ? (
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
        <DropdownMenuLabel>Filter by Location</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
        {onAddLocation && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setIsOpen(false);
                onAddLocation();
              }}
              className="cursor-pointer text-[#13274F] hover:text-[#0DBCBA] hover:bg-[#13274F]/5"
            >
              <Plus className="h-4 w-4 mr-2" />
              <span className="font-medium">Add Location</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

