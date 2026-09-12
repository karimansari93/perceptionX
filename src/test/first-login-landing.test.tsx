import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { supabase } from '@/integrations/supabase/client';
import { server } from './msw/server';
import { MockBackend } from './msw/supabase';
import * as F from './fixtures/dashboard';
import { metricEl, renderDashboard, seedSession } from './renderDashboard';

// Reliability audit P2-2: first-login setup saves the chosen brand into the
// session's user metadata AFTER the landing company was picked, so the very
// first visit landed on the organisation's default profile and the choice
// was honoured only from the next sign-in.

const waitForScorecard = () =>
  waitFor(() => expect(metricEl('eps')).not.toBeNull(), { timeout: 30_000 });

// The company switcher in the header shows the active profile's name.
const activeCompanyShown = (name: string) =>
  screen.getAllByText(name).length > 0;

describe('first-login landing', () => {
  it('lands on the brand chosen in first-login setup as soon as it is saved, without a new sign-in', async () => {
    // Two profiles in the org; the person has not completed setup yet, so
    // the session carries no default brand and the landing rule picks the
    // organisation's default profile (Acme, US).
    const backend = new MockBackend({
      user: F.userWithoutDefaults,
      tables: { organization_members: F.organizationMembersWithSibling },
    });
    server.use(...backend.handlers());
    seedSession(F.sessionWithoutDefaults);
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(activeCompanyShown('Acme')).toBe(true), { timeout: 10_000 });
    expect(screen.queryByText('Acme Canada')).toBeNull();

    // ProfileSetupGate's save: the chosen brand + market go into user_metadata.
    const { error } = await supabase.auth.updateUser({
      data: {
        default_company_id: F.SIBLING_COMPANY_ID,
        default_company_name: 'Acme Canada',
        default_location_context: 'Canada',
      },
    });
    expect(error).toBeNull();
    expect(backend.calls.some((c) => c.method === 'PUT' && c.path === '/auth/v1/user')).toBe(true);

    // The dashboard switches to the chosen profile on this visit.
    await waitFor(() => expect(activeCompanyShown('Acme Canada')).toBe(true), { timeout: 15_000 });
  });

  it('a returning user with a saved default lands on it directly', async () => {
    const backend = new MockBackend({
      user: { ...F.user, user_metadata: { ...F.user.user_metadata, default_company_id: F.SIBLING_COMPANY_ID, default_company_name: 'Acme Canada' } },
      tables: { organization_members: F.organizationMembersWithSibling },
    });
    server.use(...backend.handlers());
    seedSession({ ...F.session, user: backend.user });
    renderDashboard();

    await waitForScorecard();
    await waitFor(() => expect(activeCompanyShown('Acme Canada')).toBe(true), { timeout: 10_000 });
  });
});
