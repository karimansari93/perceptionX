import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarInset, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { User, BarChart3, ArrowLeft } from 'lucide-react';
import UserMenu from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { updatePromptText, isValidPromptUpdate } from '@/utils/promptUtils';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQueryClient } from '@tanstack/react-query';
import { CompanyBrandSelect } from '@/components/onboarding/CompanyBrandSelect';
import { LocationSelect } from '@/components/onboarding/LocationSelect';
import {
  brandForCompanyId,
  locationRawValue,
  profileSetupMetadata,
  profileSetupQueryKey,
  representativeCompanyId,
  saveDashboardFocus,
  useOrgBrands,
  useOrgLocationOptions,
  useProfileSetupStatus,
  validLocationKey,
  type OrgBrand,
} from '@/hooks/useProfileSetup';
import { canonicalizeLocationContext } from '@/utils/locationContext';

function AccountSidebar({ activeSection, onSectionChange }) {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const navigate = useNavigate();

  return (
    <Sidebar className="border-r bg-white/90 backdrop-blur-sm transition-all duration-200">
      <SidebarHeader className="border-b border-gray-200/50 flex flex-row items-center justify-between p-6">
        <img
          alt="Perception Logo"
          className="object-contain h-4"
          src={isCollapsed ? "/logos/perceptionx-small.png" : "/logos/PerceptionX-PrimaryLogo.png"}
        />
        <SidebarTrigger className="h-7 w-7 md:hidden" />
      </SidebarHeader>
      <SidebarContent className="flex-1 flex flex-col gap-2 p-0">
        <button
          onClick={() => navigate('/dashboard')}
          className={`flex items-center w-full rounded-lg px-3 py-2 text-base font-normal text-gray-700 hover:bg-gray-100 transition-colors mb-1 ${isCollapsed ? 'justify-center' : 'justify-start'}`}
          type="button"
        >
          <ArrowLeft className="w-5 h-5" />
          {!isCollapsed && <span className="ml-2">Go back</span>}
        </button>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'account'}
              onClick={() => { onSectionChange('account'); navigate('/account'); }}
              className="w-full justify-start relative"
              tooltip={isCollapsed ? 'Account & Settings' : undefined}
            >
              <User className="h-5 w-5" />
              {!isCollapsed && <span>Account & Settings</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'usage'}
              onClick={() => { onSectionChange('usage'); navigate('/usage'); }}
              className="w-full justify-start relative"
              tooltip={isCollapsed ? 'Usage & Plans' : undefined}
            >
              <BarChart3 className="h-5 w-5" />
              {!isCollapsed && <span>Usage & Plans</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-4 flex flex-col gap-3">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

export default function Account() {
  useDocumentTitle('Account');
  const [activeSection, setActiveSection] = useState('account');
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({ company: '', industry: '', email: '' });
  const [originalForm, setOriginalForm] = useState({ company: '', industry: '', email: '' });

  // Dashboard focus (subsidiary + country) — chosen at first login, editable
  // here. Kept as "saved value unless the user touched a picker" so no
  // effect has to copy query data into state.
  const queryClient = useQueryClient();
  const setupStatus = useProfileSetupStatus(user?.id);
  const brandsQuery = useOrgBrands(user?.id);
  const brands = brandsQuery.data?.brands ?? [];
  const [pickedBrandKey, setPickedBrandKey] = useState<string | null>(null);
  const brand: OrgBrand | null | undefined =
    brandsQuery.isPending || setupStatus.isPending
      ? undefined
      : (pickedBrandKey ? brands.find((b) => b.key === pickedBrandKey) : undefined) ??
        brandForCompanyId(brands, setupStatus.data?.defaultCompanyId) ??
        brands[0] ??
        null;
  const locationsQuery = useOrgLocationOptions(user?.id, brand);
  const locationOptions = locationsQuery.data ?? [];
  const locationsLoading = locationsQuery.isPending;
  const savedLocation = canonicalizeLocationContext(setupStatus.data?.defaultLocationContext);
  const [pickedLocation, setPickedLocation] = useState<string | null>(null);
  const [locationTouched, setLocationTouched] = useState(false);
  const currentLocation = locationTouched ? pickedLocation : savedLocation;
  const chooseBrand = (key: string) => {
    setPickedBrandKey(key);
    setPickedLocation(null); // countries belong to a subsidiary; start over
    setLocationTouched(true);
  };
  const focusTouched = locationTouched || pickedBrandKey !== null;

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      setLoading(true);
      // Fetch onboarding data
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name, industry')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(); // .single() 406s for users with no onboarding row
      
      const formData = {
        company: data?.company_name || '',
        industry: data?.industry || '',
        email: user.email || '',
      };
      
      setForm(formData);
      setOriginalForm(formData);
      setLoading(false);
    }
    fetchData();
  }, [user]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Function to update prompt texts when company or industry changes
  const updatePromptTexts = async (oldCompany: string, newCompany: string, oldIndustry: string, newIndustry: string) => {
    try {
      // Get all confirmed prompts for this user
      const { data: prompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id, prompt_text, prompt_type')
        .eq('user_id', user.id);

      if (promptsError) {
        console.error('Error fetching confirmed prompts:', promptsError);
        return;
      }

      if (!prompts || prompts.length === 0) {
        return;
      }

      // Update each prompt text using the utility function
      const updatePromises = prompts.map(async (prompt) => {
        const newPromptText = updatePromptText(
          prompt.prompt_text,
          oldCompany,
          newCompany,
          oldIndustry,
          newIndustry
        );

        // Only update if the text actually changed
        if (isValidPromptUpdate(prompt.prompt_text, newPromptText)) {
          const { error: updateError } = await supabase
            .from('confirmed_prompts')
            .update({ prompt_text: newPromptText })
            .eq('id', prompt.id);

          if (updateError) {
            console.error(`Error updating confirmed prompt ${prompt.id}:`, updateError);
          }
        }
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error updating prompt texts:', error);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();

    setSaving(true);
    setSuccess(false);
    try {
      // Dashboard focus: session copy (what the dashboard reads on load) plus
      // the durable profile columns.
      if (user && focusTouched && !locationsLoading) {
        const locationKey = validLocationKey(currentLocation, locationOptions);
        const { error: metaError } = await supabase.auth.updateUser({
          data: profileSetupMetadata(locationKey, locationOptions, brand),
        });
        if (metaError) throw metaError;
        await saveDashboardFocus({ locationKey, options: locationOptions, brand });
        const defaultLocationContext = locationRawValue(locationKey, locationOptions);
        const defaultCompanyId = representativeCompanyId(brand, locationKey);
        queryClient.setQueryData(profileSetupQueryKey(user.id), (prev: unknown) =>
          prev && typeof prev === 'object'
            ? { ...(prev as object), defaultLocationContext, defaultCompanyId }
            : prev,
        );
        setLocationTouched(false);
        setPickedBrandKey(null);
      }

      // Editing company info from the user-facing Account page has been
      // retired — companies are now managed by admins. Old code wrote to
      // user_onboarding (dead table); we no-op the persistence and let
      // the prompt-text refresh below run if anything actually changed.

      // Update prompt texts if industry changed
      const industryChanged = originalForm.industry !== form.industry;
      const companyChanged = originalForm.company !== form.company;
      
      if (industryChanged || companyChanged) {
        toast.info('Updating your prompts to reflect the new information...');
        await updatePromptTexts(originalForm.company, form.company, originalForm.industry, form.industry);
      }

      // Update the original form to reflect the new saved state
      setOriginalForm({ ...form });
      
      setSaving(false);
      setSuccess(true);
      
      if (industryChanged || companyChanged) {
        toast.success('Company information and prompts updated successfully!');
      } else {
        toast.success('Changes saved successfully!');
      }
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Error in handleSave:', error);
      toast.error('Failed to save changes');
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-row">
      <div className="transition-all duration-200 h-full">
        <AccountSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
      </div>
      <div className="flex-1 min-w-0">
        <SidebarInset>
          {/* Hamburger for mobile */}
          <div className="md:hidden flex items-center mb-4">
            <SidebarTrigger className="h-8 w-8" />
          </div>
          <div className="flex-1 p-8 max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Account & Settings</CardTitle>
                <CardDescription>
                  Update your company and industry information. Your existing prompts will be automatically updated to reflect changes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSave} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-1">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      className="w-full border rounded-md px-3 py-2 bg-gray-50"
                      disabled={true}
                    />
                    <p className="text-sm text-gray-500 mt-1">Email cannot be changed at this time.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Company</label>
                    <input
                      type="text"
                      name="company"
                      value={form.company}
                      onChange={handleChange}
                      className="w-full border rounded-md px-3 py-2"
                      disabled={loading || saving}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Industry</label>
                    <input
                      type="text"
                      name="industry"
                      value={form.industry}
                      onChange={handleChange}
                      className="w-full border rounded-md px-3 py-2"
                      disabled={loading || saving}
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Changing your industry will automatically update your existing prompts to reflect the new industry.
                    </p>
                  </div>
                  {brands.length > 1 && (
                    <div>
                      <label htmlFor="default-company" className="block text-sm font-medium mb-1">Dashboard focus: subsidiary</label>
                      <CompanyBrandSelect
                        id="default-company"
                        brands={brands}
                        value={brand?.key ?? null}
                        onChange={chooseBrand}
                        disabled={loading || saving}
                      />
                      <p className="text-sm text-gray-500 mt-1">The company your dashboard opens on when you sign in.</p>
                    </div>
                  )}
                  {(locationsLoading || locationOptions.length > 0) && (
                    <div>
                      <label htmlFor="default-location" className="block text-sm font-medium mb-1">Dashboard focus: country</label>
                      <LocationSelect
                        id="default-location"
                        options={locationOptions}
                        value={currentLocation}
                        onChange={(key) => { setPickedLocation(key); setLocationTouched(true); }}
                        loading={locationsLoading || setupStatus.isPending}
                        disabled={loading || saving}
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        The country your dashboard opens on when you sign in. Starring a view on the dashboard overrides this in that browser.
                      </p>
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={loading || saving}
                    className="w-full"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  {success && <div className="text-green-600 text-center mt-2">Changes saved!</div>}
                </form>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </div>
    </div>
  );
}