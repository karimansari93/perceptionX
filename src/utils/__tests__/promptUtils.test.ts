/**
 * Tests for prompt utility functions
 * These tests verify that industry and company updates work correctly
 */

import { updateIndustryInPrompt, updateCompanyInPrompt, updatePromptText, isValidPromptUpdate } from '../promptUtils';

describe('promptUtils', () => {
  describe('updateIndustryInPrompt', () => {
    it('should replace industry name in various contexts', () => {
      const testCases = [
        {
          input: 'What companies in Technology are known for outstanding culture?',
          oldIndustry: 'Technology',
          newIndustry: 'Healthcare',
          expected: 'What companies in Healthcare are known for outstanding culture?'
        },
        {
          input: 'How does the Technology industry compare to others?',
          oldIndustry: 'Technology',
          newIndustry: 'Healthcare',
          expected: 'How does the Healthcare industry compare to others?'
        },
        {
          input: 'What is the best company to work for in the Technology industry?',
          oldIndustry: 'Technology',
          newIndustry: 'Healthcare',
          expected: 'What is the best company to work for in the Healthcare industry?'
        }
      ];

      testCases.forEach(({ input, oldIndustry, newIndustry, expected }) => {
        const result = updateIndustryInPrompt(input, oldIndustry, newIndustry);
        expect(result).toBe(expected);
      });
    });

    it('should not change text when industries are the same', () => {
      const input = 'What companies in Technology are known for culture?';
      const result = updateIndustryInPrompt(input, 'Technology', 'Technology');
      expect(result).toBe(input);
    });

    it('should handle empty or null inputs gracefully', () => {
      expect(updateIndustryInPrompt('', 'Tech', 'Health')).toBe('');
      expect(updateIndustryInPrompt('test', '', 'Health')).toBe('test');
      expect(updateIndustryInPrompt('test', 'Tech', '')).toBe('test');
    });
  });

  describe('updateCompanyInPrompt', () => {
    it('should replace company name', () => {
      const input = 'How is Acme Corp as an employer?';
      const result = updateCompanyInPrompt(input, 'Acme Corp', 'TechStart Inc');
      expect(result).toBe('How is TechStart Inc as an employer?');
    });

    it('should handle companies with special characters', () => {
      const input = 'How does A&B Company compare to others?';
      const result = updateCompanyInPrompt(input, 'A&B Company', 'C&D Corp');
      expect(result).toBe('How does C&D Corp compare to others?');
    });
  });

  describe('updatePromptText', () => {
    it('should update both company and industry', () => {
      const input = 'How does Acme Corp compare to other companies in the Technology industry?';
      const result = updatePromptText(input, 'Acme Corp', 'TechStart Inc', 'Technology', 'Healthcare');
      expect(result).toBe('How does TechStart Inc compare to other companies in the Healthcare industry?');
    });

    it('should handle partial updates', () => {
      const input = 'How does Acme Corp compare to other companies in the Technology industry?';
      
      // Only company change
      const result1 = updatePromptText(input, 'Acme Corp', 'TechStart Inc', 'Technology', 'Technology');
      expect(result1).toBe('How does TechStart Inc compare to other companies in the Technology industry?');
      
      // Only industry change  
      const result2 = updatePromptText(input, 'Acme Corp', 'Acme Corp', 'Technology', 'Healthcare');
      expect(result2).toBe('How does Acme Corp compare to other companies in the Healthcare industry?');
    });
  });

  describe('isValidPromptUpdate', () => {
    it('should return true for meaningful changes', () => {
      expect(isValidPromptUpdate('old text', 'new text')).toBe(true);
    });

    it('should return false for identical text', () => {
      expect(isValidPromptUpdate('same text', 'same text')).toBe(false);
    });

    it('should return false for empty updates', () => {
      expect(isValidPromptUpdate('old text', '')).toBe(false);
      expect(isValidPromptUpdate('old text', '   ')).toBe(false);
    });

    it('should return false for whitespace-only changes', () => {
      expect(isValidPromptUpdate('old  text', 'old text')).toBe(false);
      expect(isValidPromptUpdate('old\ntext', 'old text')).toBe(false);
    });
  });
});