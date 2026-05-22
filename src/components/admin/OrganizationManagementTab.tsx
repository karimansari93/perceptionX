import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Briefcase, Users, Building2, Plus, RefreshCw, Eye, Pencil, UserPlus, Mail, Search, Calendar, Database, FileText, Upload, Trash2, Check, X } from 'lucide-react';
import { OrganizationDataDetail } from './OrganizationDataDetail';
import { generatePdfThumbnail } from '@/utils/pdfThumbnail';

const PDF_MIME = 'application/pdf';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const QUARTERS = [1, 2, 3, 4] as const;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR + 1 - i); // current year +1 down 4 years

interface CustomReportRow {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  period_year: number | null;
  period_quarter: number | null;
  region: string | null;
  thumbnail_path: string | null;
}

interface Organization {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  regions: string[];
  member_count?: number;
  company_count?: number;
}

interface User {
  id: string;
  email: string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

export const OrganizationManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filteredOrganizations, setFilteredOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [selectedOrgForData, setSelectedOrgForData] = useState<Organization | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);

  // Reports modal state
  const [reportsOrg, setReportsOrg] = useState<Organization | null>(null);
  const [orgReports, setOrgReports] = useState<CustomReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportTitle, setReportTitle] = useState('');
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportYear, setReportYear] = useState<number>(CURRENT_YEAR);
  const [reportQuarter, setReportQuarter] = useState<number>(Math.floor(new Date().getMonth() / 3) + 1);
  const [reportRegion, setReportRegion] = useState<string>('');
  const [titleEdited, setTitleEdited] = useState(false);

  // Region list editor
  const [editingRegions, setEditingRegions] = useState(false);
  const [draftRegions, setDraftRegions] = useState<string[]>([]);
  const [newRegionInput, setNewRegionInput] = useState('');
  const [savingRegions, setSavingRegions] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  
  // Form data
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'member'>('member');
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterOrganizations();
  }, [organizations, searchQuery]);

  // Auto-fill the report title from org + quarter + year + region until the
  // admin manually edits it. e.g. "Netflix — Q2 2026 — EMEA".
  useEffect(() => {
    if (!showReportsModal || !reportsOrg || titleEdited) return;
    const tail = reportRegion ? ` — ${reportRegion}` : '';
    setReportTitle(`${reportsOrg.name} — Q${reportQuarter} ${reportYear}${tail}`);
  }, [showReportsModal, reportsOrg, reportYear, reportQuarter, reportRegion, titleEdited]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load organizations with counts
      const { data: orgsData, error: orgsError } = await supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false });

      if (orgsError) throw orgsError;

      // Load member counts
      const { data: membersData } = await supabase
        .from('organization_members')
        .select('organization_id');

      // Load company counts
      const { data: companiesData } = await supabase
        .from('organization_companies')
        .select('organization_id');

      // Calculate counts
      const orgsWithCounts = (orgsData || []).map(org => ({
        ...org,
        regions: (org as any).regions ?? [],
        member_count: (membersData || []).filter(m => m.organization_id === org.id).length,
        company_count: (companiesData || []).filter(c => c.organization_id === org.id).length
      }));

      setOrganizations(orgsWithCounts);
      setFilteredOrganizations(orgsWithCounts);

      // Load all users
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, email')
        .order('email', { ascending: true });

      if (usersError) throw usersError;
      setUsers(usersData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const filterOrganizations = () => {
    if (!searchQuery) {
      setFilteredOrganizations(organizations);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = organizations.filter(org =>
      org.name.toLowerCase().includes(query) ||
      (org.description && org.description.toLowerCase().includes(query))
    );
    setFilteredOrganizations(filtered);
  };

  const loadOrgMembers = async (orgId: string) => {
    try {
      const { data: membersData, error: membersError } = await supabase
        .from('organization_members')
        .select('id, user_id, role, joined_at')
        .eq('organization_id', orgId);

      if (membersError) throw membersError;

      // Fetch profiles separately
      if (membersData && membersData.length > 0) {
        const userIds = membersData.map(m => m.user_id);
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', userIds);

        if (profilesError) throw profilesError;

        const members = membersData.map(member => ({
          id: member.id,
          user_id: member.user_id,
          email: profilesData?.find(p => p.id === member.user_id)?.email || 'Unknown',
          role: member.role,
          joined_at: member.joined_at
        }));

        setOrgMembers(members);
      } else {
        setOrgMembers([]);
      }
    } catch (error) {
      console.error('Error loading members:', error);
      toast.error('Failed to load organization members');
    }
  };

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .insert({
          name: orgName,
          description: orgDescription || null
        });

      if (error) throw error;

      toast.success('Organization created successfully');
      setShowCreateOrgModal(false);
      setOrgName('');
      setOrgDescription('');
      loadData();
    } catch (error) {
      console.error('Error creating organization:', error);
      toast.error('Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const handleAddUser = async () => {
    if (!selectedOrg || !selectedUser) {
      toast.error('Please select both organization and user');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase
        .from('organization_members')
        .insert({
          organization_id: selectedOrg.id,
          user_id: selectedUser,
          role: selectedRole
        });

      if (error) throw error;

      toast.success('User added to organization successfully');
      setShowAddUserModal(false);
      setSelectedUser('');
      setSelectedRole('member');
      loadData();
      if (showMembersModal) {
        loadOrgMembers(selectedOrg.id);
      }
    } catch (error) {
      console.error('Error adding user:', error);
      toast.error('Failed to add user to organization');
    } finally {
      setAdding(false);
    }
  };

  const loadOrgReports = async (orgId: string) => {
    setReportsLoading(true);
    try {
      const { data, error } = await supabase
        .from('custom_reports')
        .select('id, organization_id, title, description, file_path, file_size, mime_type, created_at, period_year, period_quarter, region, thumbnail_path')
        .eq('organization_id', orgId)
        .order('period_year', { ascending: false, nullsFirst: false })
        .order('period_quarter', { ascending: false, nullsFirst: false })
        .order('region', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrgReports((data || []) as CustomReportRow[]);
    } catch (err) {
      console.error('Error loading reports:', err);
      toast.error('Failed to load reports');
      setOrgReports([]);
    } finally {
      setReportsLoading(false);
    }
  };

  const handleOpenReports = (org: Organization) => {
    setReportsOrg(org);
    setReportTitle('');
    setTitleEdited(false);
    setReportFile(null);
    setReportYear(CURRENT_YEAR);
    setReportQuarter(Math.floor(new Date().getMonth() / 3) + 1);
    setReportRegion(org.regions[0] ?? '');
    setEditingReportId(null);
    setEditingRegions(false);
    setDraftRegions([]);
    setNewRegionInput('');
    setShowReportsModal(true);
    loadOrgReports(org.id);
  };

  const handleStartEditRegions = () => {
    if (!reportsOrg) return;
    setDraftRegions([...reportsOrg.regions]);
    setNewRegionInput('');
    setEditingRegions(true);
  };

  const handleAddRegionDraft = () => {
    const v = newRegionInput.trim().toUpperCase();
    if (!v) return;
    if (draftRegions.includes(v)) {
      toast.error('Region already in list');
      return;
    }
    setDraftRegions(prev => [...prev, v]);
    setNewRegionInput('');
  };

  const handleRemoveRegionDraft = (r: string) => {
    setDraftRegions(prev => prev.filter(x => x !== r));
  };

  const handleSaveRegions = async () => {
    if (!reportsOrg) return;
    setSavingRegions(true);
    try {
      const { data, error } = await supabase.rpc('admin_set_organization_regions', {
        p_org_id: reportsOrg.id,
        p_regions: draftRegions,
      });
      if (error) throw error;
      const updatedRegions: string[] = (data as any)?.regions ?? draftRegions;
      const updatedOrg = { ...reportsOrg, regions: updatedRegions };
      setReportsOrg(updatedOrg);
      setOrganizations(prev => prev.map(o => o.id === reportsOrg.id ? { ...o, regions: updatedRegions } : o));
      setFilteredOrganizations(prev => prev.map(o => o.id === reportsOrg.id ? { ...o, regions: updatedRegions } : o));
      // If current upload-form region is no longer in the list, reset.
      if (reportRegion && !updatedRegions.includes(reportRegion)) {
        setReportRegion(updatedRegions[0] ?? '');
      } else if (!reportRegion && updatedRegions.length > 0) {
        setReportRegion(updatedRegions[0]);
      }
      setEditingRegions(false);
      toast.success('Regions updated');
    } catch (err: any) {
      console.error('Save regions failed:', err);
      toast.error(err?.message || 'Failed to update regions');
    } finally {
      setSavingRegions(false);
    }
  };

  const handleUploadReport = async () => {
    if (!reportsOrg || !reportFile || !reportTitle.trim()) {
      toast.error('Title and file are required');
      return;
    }
    if (!reportRegion || !reportsOrg.regions.includes(reportRegion)) {
      toast.error('Select a region (add one via Edit regions if the list is empty)');
      return;
    }
    if (reportFile.type !== PDF_MIME && reportFile.type !== PPTX_MIME) {
      toast.error('Only PDF or PPTX files are allowed');
      return;
    }
    setUploading(true);
    try {
      const reportId = crypto.randomUUID();
      const ext = reportFile.type === PPTX_MIME ? 'pptx' : 'pdf';
      const filePath = `${reportsOrg.id}/${reportId}.${ext}`;

      const { error: uploadError } = await supabase
        .storage
        .from('custom-reports')
        .upload(filePath, reportFile, { contentType: reportFile.type, upsert: false });
      if (uploadError) throw uploadError;

      // Best-effort thumbnail (PDFs only). Failure here doesn't block upload.
      let thumbnailPath: string | null = null;
      if (reportFile.type === PDF_MIME) {
        try {
          const thumb = await generatePdfThumbnail(reportFile);
          const thumbPath = `${reportsOrg.id}/${reportId}.thumb.png`;
          const { error: thumbErr } = await supabase
            .storage
            .from('custom-reports')
            .upload(thumbPath, thumb.blob, { contentType: 'image/png', upsert: true });
          if (thumbErr) {
            console.warn('Thumbnail upload failed:', thumbErr);
          } else {
            thumbnailPath = thumbPath;
          }
        } catch (thumbErr) {
          console.warn('Thumbnail generation failed:', thumbErr);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { error: insertError } = await supabase
        .from('custom_reports')
        .insert({
          id: reportId,
          organization_id: reportsOrg.id,
          title: reportTitle.trim(),
          file_path: filePath,
          file_size: reportFile.size,
          mime_type: reportFile.type,
          uploaded_by: user?.id,
          period_year: reportYear,
          period_quarter: reportQuarter,
          region: reportRegion,
          thumbnail_path: thumbnailPath,
        });
      if (insertError) {
        // Cleanup orphaned file
        await supabase.storage.from('custom-reports').remove([filePath]);
        throw insertError;
      }

      toast.success(`Report uploaded to ${reportsOrg.name}`);
      setReportTitle('');
      setTitleEdited(false);
      setReportFile(null);
      loadOrgReports(reportsOrg.id);
    } catch (err: any) {
      console.error('Upload failed:', err);
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteReport = async (report: CustomReportRow) => {
    if (!confirm(`Delete "${report.title}"?`)) return;
    try {
      const toRemove = [report.file_path];
      if (report.thumbnail_path) toRemove.push(report.thumbnail_path);
      const { error: rmErr } = await supabase
        .storage
        .from('custom-reports')
        .remove(toRemove);
      if (rmErr) console.warn('Storage remove warning:', rmErr);

      const { error: delErr } = await supabase
        .from('custom_reports')
        .delete()
        .eq('id', report.id);
      if (delErr) throw delErr;

      toast.success('Report deleted');
      setOrgReports(prev => prev.filter(r => r.id !== report.id));
    } catch (err: any) {
      console.error('Delete failed:', err);
      toast.error(err?.message || 'Delete failed');
    }
  };

  const handleBackfillThumbnails = async () => {
    if (!reportsOrg) return;
    const missing = orgReports.filter(r => !r.thumbnail_path && r.mime_type === PDF_MIME);
    if (missing.length === 0) {
      toast.success('All PDFs already have thumbnails');
      return;
    }
    setBackfilling(true);
    setBackfillProgress({ done: 0, total: missing.length });
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < missing.length; i++) {
      const report = missing[i];
      try {
        // Download original PDF (signed URL works for admins).
        const { data: signed, error: signErr } = await supabase
          .storage
          .from('custom-reports')
          .createSignedUrl(report.file_path, 120);
        if (signErr || !signed?.signedUrl) throw signErr ?? new Error('No signed URL');
        const blob = await (await fetch(signed.signedUrl)).blob();
        const file = new File([blob], 'pdf', { type: 'application/pdf' });

        const thumb = await generatePdfThumbnail(file);
        const thumbPath = `${report.organization_id}/${report.id}.thumb.png`;
        const { error: upErr } = await supabase
          .storage
          .from('custom-reports')
          .upload(thumbPath, thumb.blob, { contentType: 'image/png', upsert: true });
        if (upErr) throw upErr;

        const { error: dbErr } = await supabase
          .from('custom_reports')
          .update({ thumbnail_path: thumbPath })
          .eq('id', report.id);
        if (dbErr) throw dbErr;

        succeeded++;
        // Reflect in local state as we go.
        setOrgReports(prev => prev.map(r => r.id === report.id ? { ...r, thumbnail_path: thumbPath } : r));
      } catch (err) {
        console.warn(`Backfill failed for ${report.id}:`, err);
        failed++;
      }
      setBackfillProgress({ done: i + 1, total: missing.length });
    }
    setBackfilling(false);
    setBackfillProgress(null);
    if (failed === 0) {
      toast.success(`Generated ${succeeded} thumbnail${succeeded === 1 ? '' : 's'}`);
    } else {
      toast.error(`Generated ${succeeded}, ${failed} failed — see console`);
    }
  };

  const handleStartRename = (report: CustomReportRow) => {
    setEditingReportId(report.id);
    setEditingTitle(report.title);
  };

  const handleSaveRename = async (report: CustomReportRow) => {
    const newTitle = editingTitle.trim();
    if (!newTitle) {
      toast.error('Title cannot be empty');
      return;
    }
    if (newTitle === report.title) {
      setEditingReportId(null);
      return;
    }
    try {
      const { error } = await supabase
        .from('custom_reports')
        .update({ title: newTitle })
        .eq('id', report.id);
      if (error) throw error;
      setOrgReports(prev => prev.map(r => r.id === report.id ? { ...r, title: newTitle } : r));
      setEditingReportId(null);
      toast.success('Title updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update title');
    }
  };

  const handleViewMembers = (org: Organization) => {
    setSelectedOrg(org);
    loadOrgMembers(org.id);
    setShowMembersModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading organizations...</p>
        </div>
      </div>
    );
  }

  if (selectedOrgForData) {
    return (
      <OrganizationDataDetail
        org={{
          id: selectedOrgForData.id,
          name: selectedOrgForData.name,
          description: selectedOrgForData.description ?? undefined,
        }}
        onBack={() => setSelectedOrgForData(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-headline font-semibold text-slate-800">Organizations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your organizations and their members</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadData} variant="outline" size="sm" className="border-slate-200 text-slate-600">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateOrgModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Organization
          </Button>
        </div>
      </div>

      {/* Search - compact */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardContent className="py-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Search Organizations</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-slate-200 h-9 pl-9 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organizations Table - focus on data */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-slate-700">
            {filteredOrganizations.length} {filteredOrganizations.length === 1 ? 'Organization' : 'Organizations'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredOrganizations.length === 0 ? (
            <div className="text-center py-10">
              <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700 mb-1">No organizations found</p>
              <p className="text-xs text-slate-500 mb-3">
                {searchQuery ? 'Try adjusting your search' : 'Create your first organization to get started'}
              </p>
              {!searchQuery && (
                <Button onClick={() => setShowCreateOrgModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create Organization
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organization Name</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organization ID</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Description</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Members</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Companies</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Created</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrganizations.map(org => (
                    <TableRow key={org.id} className="border-slate-200">
                      <TableCell className="py-2 px-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800">{org.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs font-mono text-slate-500">{org.id}</TableCell>
                      <TableCell className="py-2 px-3 text-sm text-slate-600 max-w-[200px] truncate">
                        {org.description || '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                          {org.member_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                          {org.company_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-slate-500">
                        {new Date(org.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          <Button onClick={() => setSelectedOrgForData(org)} size="sm" className="bg-pink hover:bg-pink/90 text-white h-7 text-xs">
                            <Database className="h-3.5 w-3.5 mr-1" />
                            Manage data
                          </Button>
                          <Button onClick={() => handleOpenReports(org)} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-7 text-xs">
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Reports
                          </Button>
                          <Button onClick={() => handleViewMembers(org)} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-7 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View Members
                          </Button>
                          <Button
                            onClick={() => { setSelectedOrg(org); setShowAddUserModal(true); }}
                            size="sm"
                            className="bg-teal hover:bg-teal/90 text-white h-7 text-xs"
                          >
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            Add User
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Organization Modal */}
      <Dialog open={showCreateOrgModal} onOpenChange={setShowCreateOrgModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Create New Organization</DialogTitle>
            <DialogDescription>Add a new organization to your system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Organization Name *</Label>
              <Input
                placeholder="Enter organization name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Description</Label>
              <Textarea
                placeholder="Enter organization description (optional)"
                value={orgDescription}
                onChange={(e) => setOrgDescription(e.target.value)}
                rows={3}
                className="border-silver"
              />
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateOrgModal(false);
                  setOrgName('');
                  setOrgDescription('');
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleCreateOrg} 
                disabled={creating || !orgName.trim()}
                className="bg-pink hover:bg-pink/90"
              >
                {creating ? 'Creating...' : 'Create Organization'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add User Modal */}
      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Add User to Organization</DialogTitle>
            <DialogDescription>
              Add a user to {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">User *</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-nightsky/60" />
                        {user.email}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Role *</Label>
              <Select value={selectedRole} onValueChange={(value: any) => setSelectedRole(value)}>
                <SelectTrigger className="border-silver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddUserModal(false);
                  setSelectedUser('');
                  setSelectedRole('member');
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddUser} 
                disabled={adding || !selectedUser}
                className="bg-teal hover:bg-teal/90"
              >
                {adding ? 'Adding...' : 'Add User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reports Modal */}
      <Dialog open={showReportsModal} onOpenChange={setShowReportsModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-nightsky">
              Custom Reports — <span className="text-pink">{reportsOrg?.name}</span>
            </DialogTitle>
            <DialogDescription>
              Upload PDF or PPTX reports. Members of {reportsOrg?.name} will see them under Analyze → Reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Upload form */}
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Year *</Label>
                  <Select value={String(reportYear)} onValueChange={(v) => setReportYear(Number(v))}>
                    <SelectTrigger className="h-9 text-sm border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Quarter *</Label>
                  <Select value={String(reportQuarter)} onValueChange={(v) => setReportQuarter(Number(v))}>
                    <SelectTrigger className="h-9 text-sm border-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {QUARTERS.map(q => (
                        <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-slate-600">Region *</Label>
                    <button
                      type="button"
                      onClick={handleStartEditRegions}
                      className="text-[10px] text-pink hover:underline"
                    >
                      Edit regions
                    </button>
                  </div>
                  {reportsOrg && reportsOrg.regions.length > 0 ? (
                    <Select value={reportRegion} onValueChange={setReportRegion}>
                      <SelectTrigger className="h-9 text-sm border-slate-200"><SelectValue placeholder="Select region" /></SelectTrigger>
                      <SelectContent>
                        {reportsOrg.regions.map(r => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="h-9 px-2 flex items-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-md">
                      No regions yet — click "Edit regions"
                    </div>
                  )}
                </div>
              </div>

              {/* Regions editor */}
              {editingRegions && (
                <div className="space-y-2 rounded-md border border-pink/30 bg-pink/5 p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-slate-700">Edit regions for {reportsOrg?.name}</Label>
                    <button
                      type="button"
                      onClick={() => setEditingRegions(false)}
                      className="text-[11px] text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {draftRegions.length === 0 && (
                      <span className="text-[11px] text-slate-400">No regions yet. Add one below.</span>
                    )}
                    {draftRegions.map(r => (
                      <span key={r} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-xs text-slate-700">
                        {r}
                        <button
                          type="button"
                          onClick={() => handleRemoveRegionDraft(r)}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. APAC, NAM, EU, US-East..."
                      value={newRegionInput}
                      onChange={(e) => setNewRegionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddRegionDraft(); }
                      }}
                      className="h-8 text-sm"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={handleAddRegionDraft} className="h-8 text-xs">
                      Add
                    </Button>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveRegions}
                      disabled={savingRegions}
                      className="h-7 text-xs bg-pink hover:bg-pink/90 text-white"
                    >
                      {savingRegions ? 'Saving…' : 'Save regions'}
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Title *</Label>
                <Input
                  placeholder="e.g. Q1 2026 Talent Perception Report"
                  value={reportTitle}
                  onChange={(e) => { setReportTitle(e.target.value); setTitleEdited(true); }}
                  className="border-slate-200 h-9 text-sm"
                />
                <p className="text-[10px] text-slate-400">Auto-generated from selectors above — edit if needed.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">File (PDF or PPTX) *</Label>
                <Input
                  type="file"
                  accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={(e) => setReportFile(e.target.files?.[0] || null)}
                  className="border-slate-200 h-9 text-sm"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleUploadReport}
                  disabled={uploading || !reportTitle.trim() || !reportFile}
                  size="sm"
                  className="bg-pink hover:bg-pink/90 text-white"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {uploading ? 'Uploading…' : 'Upload report'}
                </Button>
              </div>
            </div>

            {/* Existing reports */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Uploaded reports ({orgReports.length})
                </h4>
                {orgReports.some(r => !r.thumbnail_path && r.mime_type === PDF_MIME) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleBackfillThumbnails}
                    disabled={backfilling}
                    className="h-7 text-[11px]"
                  >
                    {backfilling
                      ? `Generating ${backfillProgress?.done ?? 0}/${backfillProgress?.total ?? 0}…`
                      : 'Generate missing thumbnails'}
                  </Button>
                )}
              </div>
              {reportsLoading ? (
                <div className="text-center py-6 text-sm text-slate-400">Loading…</div>
              ) : orgReports.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-400 border border-dashed border-slate-200 rounded-md">
                  No reports uploaded yet
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                        <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Title</TableHead>
                        <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Period</TableHead>
                        <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Region</TableHead>
                        <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Type</TableHead>
                        <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Uploaded</TableHead>
                        <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgReports.map(report => (
                        <TableRow key={report.id} className="border-slate-200">
                          <TableCell className="py-2 px-3 text-sm">
                            {editingReportId === report.id ? (
                              <Input
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(report);
                                  if (e.key === 'Escape') setEditingReportId(null);
                                }}
                                autoFocus
                                className="h-7 text-sm"
                              />
                            ) : (
                              <span className="font-medium text-slate-800">{report.title}</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs text-slate-500">
                            {report.period_year && report.period_quarter
                              ? `Q${report.period_quarter} ${report.period_year}`
                              : '—'}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs text-slate-500">
                            {report.region ?? '—'}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs text-slate-500">
                            {report.mime_type === PPTX_MIME ? 'PPTX' : 'PDF'}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs text-slate-500">
                            {new Date(report.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-right">
                            <div className="flex gap-1 justify-end">
                              {editingReportId === report.id ? (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleSaveRename(report)}>
                                    <Check className="h-3.5 w-3.5 text-green-600" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingReportId(null)}>
                                    <X className="h-3.5 w-3.5 text-slate-500" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleStartRename(report)}>
                                    <Pencil className="h-3.5 w-3.5 text-slate-500" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-red-50" onClick={() => handleDeleteReport(report)}>
                                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setShowReportsModal(false)} variant="outline" className="border-silver">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Members Modal */}
      <Dialog open={showMembersModal} onOpenChange={setShowMembersModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Organization Members</DialogTitle>
            <DialogDescription>
              Members of {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {orgMembers.length === 0 ? (
              <div className="text-center py-8 text-nightsky/60">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No members in this organization yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgMembers.map(member => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-nightsky/60" />
                          {member.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === 'owner' ? 'default' : 'secondary'} className={
                          member.role === 'owner' ? 'bg-pink' : 
                          member.role === 'admin' ? 'bg-teal' : 'bg-nightsky/20 text-nightsky'
                        }>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-nightsky/60">
                        {new Date(member.joined_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex justify-between pt-4">
              <Button
                onClick={() => {
                  setShowAddUserModal(true);
                }}
                size="sm"
                className="bg-teal hover:bg-teal/90"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
              <Button
                onClick={() => setShowMembersModal(false)}
                variant="outline"
                className="border-silver"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};


