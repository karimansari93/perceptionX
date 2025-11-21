import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Hash, Plus, RefreshCw, Search } from 'lucide-react';
import { CompanySearchTermsService, CompanySearchTerm } from '@/services/companySearchTermsService';

interface CompanySearchTermsTabProps {
  companyId: string;
  companyName: string;
}

export const CompanySearchTermsTab = ({ companyId, companyName }: CompanySearchTermsTabProps) => {
  const [searchTerms, setSearchTerms] = useState<CompanySearchTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSearchTerm, setNewSearchTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadSearchTerms();
  }, [companyId]);

  const loadSearchTerms = async () => {
    setLoading(true);
    try {
      const terms = await CompanySearchTermsService.getSearchTerms(companyId);
      setSearchTerms(terms);
    } catch (error) {
      console.error('Error loading search terms:', error);
      toast.error('Failed to load search terms');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSearchTerm = async () => {
    if (!newSearchTerm.trim()) {
      toast.error('Please enter a search term');
      return;
    }

    setAdding(true);
    try {
      await CompanySearchTermsService.addSearchTerm({
        company_id: companyId,
        search_term: newSearchTerm.trim()
      });

      toast.success('Search term added successfully');
      setShowAddModal(false);
      setNewSearchTerm('');
      loadSearchTerms();
    } catch (error: any) {
      console.error('Error adding search term:', error);
      toast.error(`Failed to add search term: ${error.message || 'Unknown error'}`);
    } finally {
      setAdding(false);
    }
  };

  const handleSearchNewTerms = async () => {
    const manualTerms = searchTerms.filter(term => term.is_manual);
    if (manualTerms.length === 0) {
      toast.error('No admin-added terms to search');
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-new-admin-terms', {
        body: {
          company_id: companyId,
          search_terms: manualTerms.map(term => term.search_term)
        }
      });

      if (error) throw error;

      toast.success(`Searched ${manualTerms.length} admin terms successfully`);
      loadSearchTerms();
    } catch (error) {
      console.error('Error searching new terms:', error);
      toast.error('Failed to search new terms');
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-pink" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-nightsky flex items-center gap-2">
              <Hash className="h-5 w-5 text-teal" />
              Search Terms for {companyName}
            </CardTitle>
            <div className="flex gap-2">
              <Button 
                onClick={handleSearchNewTerms}
                disabled={searching || searchTerms.filter(t => t.is_manual).length === 0}
                variant="outline"
                className="border-silver"
              >
                <Search className="h-4 w-4 mr-2" />
                {searching ? 'Searching...' : 'Search New Terms'}
              </Button>
              <Button onClick={() => setShowAddModal(true)} className="bg-pink hover:bg-pink/90">
                <Plus className="h-4 w-4 mr-2" />
                Add Search Term
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {searchTerms.length === 0 ? (
            <div className="text-center py-12">
              <Hash className="h-16 w-16 text-silver mx-auto mb-4" />
              <p className="text-lg font-medium text-nightsky mb-2">No search terms yet</p>
              <p className="text-sm text-nightsky/60 mb-4">Add search terms to track for this company</p>
              <Button onClick={() => setShowAddModal(true)} className="bg-pink hover:bg-pink/90">
                <Plus className="h-4 w-4 mr-2" />
                Add First Search Term
              </Button>
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
                    <TableCell className="font-medium text-nightsky">{term.search_term}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-teal/30 text-teal bg-teal/5">
                        {term.monthly_volume.toLocaleString()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={term.is_manual ? 'default' : 'secondary'} 
                        className={term.is_manual ? 'bg-pink' : 'bg-nightsky/20 text-nightsky'}>
                        {term.is_manual ? 'Manual' : 'Auto'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-nightsky/60">
                      {new Date(term.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Search Term Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Add Search Term</DialogTitle>
            <DialogDescription>
              Add a new search term for {companyName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Search Term *</Label>
              <Input
                placeholder="e.g., software engineer jobs"
                value={newSearchTerm}
                onChange={(e) => setNewSearchTerm(e.target.value)}
                className="border-silver"
              />
              <p className="text-sm text-nightsky/60">
                Monthly search volume will be automatically fetched when search insights runs
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  setNewSearchTerm('');
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddSearchTerm} 
                disabled={adding || !newSearchTerm.trim()}
                className="bg-pink hover:bg-pink/90"
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











