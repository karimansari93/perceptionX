import { supabase } from '@/integrations/supabase/client';

export interface CompanySearchTerm {
  id: string;
  company_id: string;
  search_term: string;
  monthly_volume: number;
  is_manual: boolean;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSearchTermRequest {
  company_id: string;
  search_term: string;
}

export interface UpdateSearchTermRequest {
  id: string;
  search_term?: string;
}

export class CompanySearchTermsService {
  /**
   * Get search terms for a specific company
   */
  static async getSearchTerms(companyId: string): Promise<CompanySearchTerm[]> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        body: { action: 'list', company_id: companyId }
      });

      if (error) throw error;
      return data?.search_terms || [];
    } catch (error) {
      console.error('Error fetching search terms:', error);
      throw error;
    }
  }

  /**
   * Get all search terms (admin only)
   */
  static async getAllSearchTerms(): Promise<CompanySearchTerm[]> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        body: { action: 'list-all' }
      });

      if (error) throw error;
      return data?.search_terms || [];
    } catch (error) {
      console.error('Error fetching all search terms:', error);
      throw error;
    }
  }

  /**
   * Add a new search term to a company
   */
  static async addSearchTerm(request: CreateSearchTermRequest): Promise<CompanySearchTerm> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        method: 'POST',
        body: request
      });

      if (error) throw error;
      return data?.search_term;
    } catch (error) {
      console.error('Error adding search term:', error);
      throw error;
    }
  }

  /**
   * Update an existing search term
   */
  static async updateSearchTerm(request: UpdateSearchTermRequest): Promise<CompanySearchTerm> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        method: 'PUT',
        body: request
      });

      if (error) throw error;
      return data?.search_term;
    } catch (error) {
      console.error('Error updating search term:', error);
      throw error;
    }
  }

  /**
   * Delete a search term
   */
  static async deleteSearchTerm(termId: string): Promise<void> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        body: { action: 'delete', id: termId }
      });

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting search term:', error);
      throw error;
    }
  }

  /**
   * Search for search terms by term text
   */
  static async searchTerms(searchTerm: string): Promise<CompanySearchTerm[]> {
    try {
      const { data, error } = await supabase.functions.invoke('manage-company-search-terms', {
        body: { action: 'search', search_term: searchTerm }
      });

      if (error) throw error;
      return data?.search_terms || [];
    } catch (error) {
      console.error('Error searching terms:', error);
      throw error;
    }
  }
}
