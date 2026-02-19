import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, Plus, RefreshCw, Building2, Hash } from 'lucide-react';
import { CompanySearchTermsService, CompanySearchTerm } from '@/services/companySearchTermsService';

interface Company {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
}

// Use the interface from the service

export const CompanySearchTermsTab = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [searchTerms, setSearchTerms] = useState<CompanySearchTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Form data
  const [newSearchTerm, setNewSearchTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [searchingNewTerms, setSearchingNewTerms] = useState(false);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('companies')
        .select(`
          *,
          organization_companies!inner(
            organization_id,
            organizations!inner(name)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const companiesWithOrg = (data || []).map(company => ({
        ...company,
        organization_id: company.organization_companies[0]?.organization_id,
        organization_name: company.organization_companies[0]?.organizations?.name || 'Unknown'
      }));

      setCompanies(companiesWithOrg);
    } catch (error) {
      console.error('Error loading companies:', error);
      toast.error('Failed to load companies');
    } finally {
      setLoading(false);
    }
  };

  const loadSearchTerms = async (companyId: string) => {
    setSearchLoading(true);
    try {
      const terms = await CompanySearchTermsService.getSearchTerms(companyId);
      setSearchTerms(terms);
    } catch (error) {
      console.error('Error loading search terms:', error);
      toast.error('Failed to load search terms');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCompanySelect = (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    setSelectedCompany(company || null);
    if (company) {
      loadSearchTerms(company.id);
    }
  };

  const handleAddSearchTerm = async () => {
    if (!selectedCompany || !newSearchTerm.trim()) {
      toast.error('Please select a company and enter a search term');
      return;
    }

    setAdding(true);
    try {
      const result = await CompanySearchTermsService.addSearchTerm({
        company_id: selectedCompany.id,
        search_term: newSearchTerm.trim()
      });

      toast.success('Search term added successfully');
      setShowAddModal(false);
      setNewSearchTerm('');
      loadSearchTerms(selectedCompany.id);
    } catch (error) {
      console.error('Error adding search term:', error);
      toast.error(`Failed to add search term: ${error.message || 'Unknown error'}`);
    } finally {
      setAdding(false);
    }
  };


  const handleSearchNewTerms = async () => {
    if (!selectedCompany) {
      toast.error('Please select a company first');
      return;
    }

    const manualTerms = searchTerms.filter(term => term.is_manual);
    if (manualTerms.length === 0) {
      toast.error('No admin-added terms to search');
      return;
    }

    setSearchingNewTerms(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-new-admin-terms', {
        body: {
          company_id: selectedCompany.id,
          search_terms: manualTerms.map(term => term.search_term)
        }
      });

      if (error) throw error;

      toast.success(`Searched ${manualTerms.length} admin terms successfully`);
      // Refresh the search terms to get updated volume data
      loadSearchTerms(selectedCompany.id);
    } catch (error) {
      console.error('Error searching new terms:', error);
      toast.error('Failed to search new terms');
    } finally {
      setSearchingNewTerms(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12">Loading companies...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Company Search Terms Management</h2>
        <Button onClick={loadCompanies} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Company Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-500" />
            Select Company
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedCompany?.id || ''} onValueChange={handleCompanySelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a company to manage search terms" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(company => (
                <SelectItem key={company.id} value={company.id}>
                  {company.name} ({company.industry}) - {company.organization_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Search Terms Management */}
      {selectedCompany && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5 text-green-500" />
                Search Terms for {selectedCompany.name}
              </CardTitle>
              <div className="flex gap-2">
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Search Term
                </Button>
                <Button 
                  onClick={handleSearchNewTerms} 
                  disabled={searchingNewTerms || searchTerms.filter(term => term.is_manual).length === 0}
                  variant="outline"
                >
                  <Search className="h-4 w-4 mr-2" />
                  {searchingNewTerms ? 'Searching...' : 'Search New Terms'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {searchLoading ? (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                Loading search terms...
              </div>
            ) : searchTerms.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Hash className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No search terms found for this company.</p>
                <p className="text-sm">Add some search terms to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Search Term</TableHead>
                    <TableHead>Monthly Volume</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchTerms.map(term => (
                    <TableRow key={term.id}>
                      <TableCell className="font-medium">{term.search_term}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {term.monthly_volume.toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={term.is_manual ? 'default' : 'secondary'}>
                          {term.is_manual ? 'Manual' : 'Auto'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(term.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Search Term Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Search Term</DialogTitle>
            <DialogDescription>
              Add a new search term for {selectedCompany?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Search Term *</Label>
              <Input
                placeholder="e.g., software engineer jobs"
                value={newSearchTerm}
                onChange={(e) => setNewSearchTerm(e.target.value)}
              />
              <p className="text-sm text-gray-500">
                Monthly search volume will be automatically fetched when search insights runs
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  setNewSearchTerm('');
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddSearchTerm} 
                disabled={adding || !newSearchTerm.trim()}
              >
                {adding ? 'Adding...' : 'Add Search Term'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};
