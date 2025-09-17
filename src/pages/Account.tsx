import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarInset, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { User, BarChart3, ArrowLeft, Lock } from 'lucide-react';
import UserMenu from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradeModal } from '@/components/upgrade/UpgradeModal';
import { updatePromptText, isValidPromptUpdate } from '@/utils/promptUtils';

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
  const [activeSection, setActiveSection] = useState('account');
  const { user } = useAuth();
  const { isPro, canUpdateData, getLimits } = useSubscription();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [form, setForm] = useState({ company: '', industry: '', email: '' });
  const [originalForm, setOriginalForm] = useState({ company: '', industry: '', email: '' });

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
        .single();
      
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
    console.log('Starting prompt text updates...', {
      oldCompany,
      newCompany,
      oldIndustry,
      newIndustry,
      userId: user?.id
    });

    try {
      // Get all confirmed prompts for this user
      const { data: prompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id, prompt_text, prompt_type, talentx_attribute_id')
        .eq('user_id', user.id);

      if (promptsError) {
        console.error('Error fetching confirmed prompts:', promptsError);
        return;
      }

      if (!prompts || prompts.length === 0) {
        console.log('No confirmed prompts found for this user');
        return;
      }

      // Update each prompt text using the utility function
      console.log(`Found ${prompts.length} confirmed prompts to update`);
      
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
          console.log(`Updating confirmed prompt ${prompt.id}:`, {
            oldText: prompt.prompt_text.substring(0, 50) + '...',
            newText: newPromptText.substring(0, 50) + '...',
            oldCompany,
            newCompany,
            oldIndustry,
            newIndustry
          });

          const { error: updateError } = await supabase
            .from('confirmed_prompts')
            .update({ prompt_text: newPromptText })
            .eq('id', prompt.id);

          if (updateError) {
            console.error(`Error updating confirmed prompt ${prompt.id}:`, updateError);
          } else {
            console.log(`Successfully updated confirmed prompt ${prompt.id}`);
          }
        } else {
          console.log(`Confirmed prompt ${prompt.id}: No changes needed`);
        }
      });

      await Promise.all(updatePromises);

      // Also update TalentX Pro prompts if user is Pro
      if (isPro) {
        console.log('Updating TalentX Pro prompts for Pro user...');
        const { data: talentxPrompts, error: talentxError } = await supabase
          .from('confirmed_prompts')
          .select('id, prompt_text, prompt_category')
          .eq('user_id', user.id)
          .eq('is_pro_prompt', true);

        if (talentxError) {
          console.error('Error fetching TalentX prompts:', talentxError);
        } else if (talentxPrompts && talentxPrompts.length > 0) {
          console.log(`Found ${talentxPrompts.length} TalentX prompts to update`);
          
          const talentxUpdatePromises = talentxPrompts.map(async (prompt) => {
            const newPromptText = updatePromptText(
              prompt.prompt_text,
              oldCompany,
              newCompany,
              oldIndustry,
              newIndustry
            );

            // Prepare update object - for confirmed_prompts we only update prompt_text
            const updateData: any = {};

            // Only update prompt_text if it actually changed
            if (isValidPromptUpdate(prompt.prompt_text, newPromptText)) {
              updateData.prompt_text = newPromptText;
              console.log(`Updating TalentX prompt ${prompt.id}:`, {
                oldText: prompt.prompt_text.substring(0, 50) + '...',
                newText: newPromptText.substring(0, 50) + '...',
                oldCompany,
                newCompany,
                oldIndustry,
                newIndustry
              });

              const { error: updateError } = await supabase
                .from('confirmed_prompts')
                .update(updateData)
                .eq('id', prompt.id);

              if (updateError) {
                console.error(`Error updating TalentX prompt ${prompt.id}:`, updateError);
              } else {
                console.log(`Successfully updated TalentX prompt ${prompt.id}`);
              }
            } else {
              console.log(`TalentX prompt ${prompt.id}: No changes needed for prompt text`);
            }
          });

          await Promise.all(talentxUpdatePromises);
        } else {
          console.log('No TalentX prompts found for this user');
        }
      }
    } catch (error) {
      console.error('Error updating prompt texts:', error);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    
    if (!canUpdateData) {
      toast.error('Updating data requires a Pro subscription');
      return;
    }
    
    setSaving(true);
    setSuccess(false);
    try {
      // First, get the latest onboarding record ID
      const { data: onboardingData, error: fetchError } = await supabase
        .from('user_onboarding')
        .select('id, company_name, industry')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (fetchError) {
        console.error('Error fetching onboarding data:', fetchError);
        toast.error('Failed to fetch current data');
        setSaving(false);
        return;
      }

      // Update onboarding data using the specific ID
      const { error: updateError } = await supabase
        .from('user_onboarding')
        .update({ 
          company_name: form.company, 
          industry: form.industry 
        })
        .eq('id', onboardingData.id);

      if (updateError) {
        console.error('Error updating onboarding data:', updateError);
        toast.error('Failed to save changes');
        setSaving(false);
        return;
      }

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
                  {isPro 
                    ? "Update your company and industry information. Your existing prompts will be automatically updated to reflect changes." 
                    : "Pro subscription required to update account information."
                  }
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
                    <div className="relative">
                      <input
                        type="text"
                        name="company"
                        value={form.company}
                        onChange={handleChange}
                        className={`w-full border rounded-md px-3 py-2 ${
                          !canUpdateData ? 'bg-gray-50 cursor-not-allowed' : ''
                        }`}
                        disabled={loading || saving || !canUpdateData}
                      />
                      {!canUpdateData && (
                        <div className="absolute inset-0 flex items-center justify-end pr-3">
                          <Lock className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                    </div>
                    {!canUpdateData && (
                      <p className="text-sm text-orange-600 mt-1">
                        Upgrade to Pro to edit company information
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Industry</label>
                    <div className="relative">
                      <input
                        type="text"
                        name="industry"
                        value={form.industry}
                        onChange={handleChange}
                        className={`w-full border rounded-md px-3 py-2 ${
                          !canUpdateData ? 'bg-gray-50 cursor-not-allowed' : ''
                        }`}
                        disabled={loading || saving || !canUpdateData}
                      />
                      {!canUpdateData && (
                        <div className="absolute inset-0 flex items-center justify-end pr-3">
                          <Lock className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                    </div>
                    {!canUpdateData && (
                      <p className="text-sm text-orange-600 mt-1">
                        Upgrade to Pro to edit industry information
                      </p>
                    )}
                    {canUpdateData && (
                      <p className="text-sm text-gray-500 mt-1">
                        Changing your industry will automatically update your existing prompts to reflect the new industry.
                      </p>
                    )}
                  </div>
                  <Button 
                    type="submit" 
                    disabled={loading || saving || !canUpdateData} 
                    className="w-full"
                  >
                    {saving ? 'Saving...' : canUpdateData ? 'Save Changes' : 'Pro Required'}
                  </Button>
                  {success && <div className="text-green-600 text-center mt-2">Changes saved!</div>}
                  {!canUpdateData && (
                    <div className="text-center">
                      <Button 
                        variant="outline" 
                        onClick={() => setShowUpgradeModal(true)}
                        className="mt-2"
                      >
                        Upgrade to Pro
                      </Button>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </div>
      
      <UpgradeModal 
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
      />
    </div>
  );
} 