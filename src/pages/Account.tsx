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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({ company: '', industry: '', email: '' });

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
      setForm({
        company: data?.company_name || '',
        industry: data?.industry || '',
        email: user.email || '',
      });
      setLoading(false);
    }
    fetchData();
  }, [user]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    try {
      // Update onboarding data
      const { error } = await supabase
        .from('user_onboarding')
        .update({ 
          company_name: form.company, 
          industry: form.industry 
        })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error updating data:', error);
        toast.error('Failed to save changes');
        return;
      }

      setSaving(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
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
                <CardDescription>Update your company and industry information.</CardDescription>
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
                  </div>
                  <Button type="submit" disabled={loading || saving} className="w-full">
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