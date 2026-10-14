// The floating Ask PerceptionX bubble: it picks up what the user clicks on
// the dashboard and hands questions to the chat page like the overview box.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { nudgeFor } from '@/lib/askAiNudges';

describe('bubble nudges', () => {
  it('asks about competitors, naming the one clicked', () => {
    expect(nudgeFor({ section: 'competitors', area: 'competitors-eoc' }).prompt).toBe('Got a question about your competitors?');
    const n = nudgeFor({ section: 'competitors', area: 'competitors-eoc', subject: 'Globex', companyName: 'Acme' });
    expect(n.prompt).toBe('Got a question about Globex?');
    expect(n.suggestions).toContain('How does Acme compare with Globex?');
  });

  it('never uses em dashes in its copy', () => {
    for (const section of ['overview', 'competitors', 'sources', 'thematic', 'prompts']) {
      for (const subject of [null, 'X']) {
        const n = nudgeFor({ section, subject, companyName: 'Acme' });
        expect([n.prompt, n.placeholder, ...n.suggestions].join(' ')).not.toContain('—');
      }
    }
  });
});

describe('AskAiBubble', () => {
  it('nudges on a competitor click and sends the question to /chat with the dashboard scope', async () => {
    vi.resetModules();
    const navigate = vi.fn();
    vi.doMock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
    vi.doMock('@/contexts/CompanyContext', () => ({ useCompany: () => ({ currentCompany: { name: 'Acme', organization_id: 'org-1' } }) }));
    const { AskAiBubble } = await import('@/components/chat/AskAiBubble');

    render(
      <>
        <div data-tour="competitors-eoc">
          <button data-ask-subject="Globex">Globex</button>
        </div>
        <AskAiBubble section="competitors" market="United States" jobFunction="all" />
      </>,
    );

    expect(screen.getByText('Got a question about your competitors?')).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByText('Globex')); });
    fireEvent.click(screen.getByText('Got a question about Globex?'));

    fireEvent.click(screen.getByText('How does Acme compare with Globex?'));
    expect(navigate).toHaveBeenCalledWith('/chat', {
      state: {
        question: 'How does Acme compare with Globex?',
        scope: { company: 'Acme', locations: ['United States'], jobFunctions: [] },
      },
    });
  });
});
