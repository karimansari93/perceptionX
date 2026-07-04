// Data access for the conversational intake.
//
// Client side (tokenized, unauthenticated): everything goes through
// SECURITY DEFINER RPCs — the anon role has no direct access to the intake
// tables, so a token is the only key that opens exactly one invite.
//
// Admin side: direct table reads/writes under the is_admin() RLS policies.
//
// The new tables/functions aren't in the generated Database types yet, hence
// the localized casts in here — keep them in this file only.

import { supabase } from '@/integrations/supabase/client';
import type { ConfirmedPromptRow, IntakePayload, OwnedDomainSeed } from './types';

export type IntakeInviteStatus = 'sent' | 'in_progress' | 'submitted' | 'reviewed' | 'approved';

export interface IntakeInvite {
  id: string;
  org_id: string | null;
  company_name: string;
  contact_email: string;
  token: string;
  status: IntakeInviteStatus;
  expires_at: string;
  created_by: string | null;
  created_at: string;
}

export interface IntakeSubmission {
  id: string;
  invite_id: string;
  payload: IntakePayload;
  draft: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type IntakeTokenError =
  | 'not_found'
  | 'expired'
  | 'already_submitted'
  | 'payload_too_large'
  | string;

export interface IntakeTokenState {
  company_name: string;
  status: IntakeInviteStatus;
  expires_at: string;
  draft: IntakePayload | null;
  submitted: boolean;
}

const rpc = (name: string, args: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.rpc as any)(name, args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string) => supabase.from(name as any) as any;

export function intakeLinkFor(token: string): string {
  return `${window.location.origin}/onboarding/${token}`;
}

// ---------------------------------------------------------------------------
// Client (token) side
// ---------------------------------------------------------------------------

export async function getIntakeByToken(
  token: string,
): Promise<{ state?: IntakeTokenState; error?: IntakeTokenError }> {
  const { data, error } = await rpc('intake_get_by_token', { p_token: token });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error as IntakeTokenError };
  return { state: data as IntakeTokenState };
}

export async function saveIntakeDraft(
  token: string,
  payload: IntakePayload,
): Promise<{ ok: boolean; error?: IntakeTokenError }> {
  const { data, error } = await rpc('intake_save_draft', { p_token: token, p_payload: payload });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error as IntakeTokenError };
  return { ok: true };
}

export async function submitIntake(
  token: string,
  payload: IntakePayload,
): Promise<{ ok: boolean; error?: IntakeTokenError }> {
  const { data, error } = await rpc('intake_submit', { p_token: token, p_payload: payload });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error as IntakeTokenError };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export async function createIntakeInvite(
  companyName: string,
  contactEmail: string,
  orgId?: string | null,
): Promise<IntakeInvite> {
  const { data, error } = await rpc('create_intake_invite', {
    p_company_name: companyName,
    p_contact_email: contactEmail,
    p_org_id: orgId ?? null,
  });
  if (error) throw error;
  return data as IntakeInvite;
}

export async function listIntakeInvites(): Promise<IntakeInvite[]> {
  const { data, error } = await table('intake_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as IntakeInvite[];
}

export async function getIntakeSubmission(inviteId: string): Promise<IntakeSubmission | null> {
  const { data, error } = await table('intake_submissions')
    .select('*')
    .eq('invite_id', inviteId)
    .maybeSingle();
  if (error) throw error;
  return (data as IntakeSubmission) ?? null;
}

/** Admin opened the brief: submitted → reviewed (one-way, before approval). */
export async function markIntakeReviewed(inviteId: string): Promise<void> {
  const { error } = await table('intake_invites')
    .update({ status: 'reviewed' })
    .eq('id', inviteId)
    .eq('status', 'submitted');
  if (error) throw error;
}

/** Persist admin edits to a submitted brief before approval. */
export async function updateIntakeSubmissionPayload(
  submissionId: string,
  payload: IntakePayload,
): Promise<void> {
  const { error } = await table('intake_submissions')
    .update({ payload })
    .eq('id', submissionId);
  if (error) throw error;
}

export interface ApproveResult {
  ok: boolean;
  /** The organization the brief was approved into (created if none existed). */
  org_id: string;
  companies: Record<string, string>;
  prompts_inserted: number;
  prompts_skipped_existing: number;
}

export async function approveIntake(
  inviteId: string,
  rows: ConfirmedPromptRow[],
  brief: IntakePayload,
  ownedDomains: OwnedDomainSeed[],
): Promise<ApproveResult> {
  const { data, error } = await rpc('admin_approve_intake', {
    p_invite_id: inviteId,
    p_rows: rows,
    p_brief: brief,
    p_owned_domains: ownedDomains,
  });
  if (error) throw error;
  return data as ApproveResult;
}
