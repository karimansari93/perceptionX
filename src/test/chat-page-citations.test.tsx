// Page citations in Ask PerceptionX answers: a table cell holding only a
// link names the page, not just the site.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from '@/components/chat/ChatMessage';

describe('page citations in answer tables', () => {
  it('shows the page title with the site underneath', () => {
    const url = 'https://builtin.com/company/acme/faq';
    const content = [
      '| Page | % of answers citing |',
      '| --- | --- |',
      `| [Work-Life Balance & Wellbeing FAQ](${url}) | 2% |`,
    ].join('\n');
    render(<ChatMessage message={{ id: 'm1', role: 'assistant', content } as any} />);

    const link = screen.getByText('Work-Life Balance & Wellbeing FAQ').closest('a');
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveTextContent('Built In');
  });
});
