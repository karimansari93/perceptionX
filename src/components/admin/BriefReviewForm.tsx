// Editable project-brief form — every field of the submitted onboarding brief
// as a live control. Rendered by the admin brief review page; the page owns
// loading, saving, and approval.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CANONICAL_JOB_FUNCTIONS,
  OnboardingPayload,
  MANAGED_PLATFORM_OPTIONS,
} from '@/lib/onboarding/types';
import {
  ChipAdder,
  EntityEditor,
  MultiChipSelect,
  PriorityEditor,
  PropertyEditor,
  RecipientEditor,
} from '@/components/onboarding/inputs';
import { COUNTRY_NAMES } from '@/lib/marketName';

interface BriefReviewFormProps {
  companyName: string;
  payload: OnboardingPayload;
  onPatch: (p: Partial<OnboardingPayload>) => void;
  /**
   * 'client' is for screen-sharing the brief on a call: same editable fields,
   * but labels drop the internal mechanics (prompt sets, benchmarking, tracking
   * grain) that read as jargon to the client whose brief this is.
   */
  variant?: 'admin' | 'client';
}

/** Admin label → what the client sees when the brief is on screen with them. */
const CLIENT_LABELS: Record<string, string> = {
  'Employer entities (tracked separately get their own prompt set)': 'Company & brands',
  'Functions by market': 'Which functions in which market',
  'Talent competitors (context only — not competitor tracking)': 'Talent competitors',
  'Industry by function (benchmark each function in its own industry)':
    'Industry for each function',
  'Career site URL': 'Career site',
  'Owned properties': 'Careers channels & profiles',
  'Managed review platforms': 'Review platforms you manage',
  'Career-stage grain': 'Career stage',
  'Talent priorities (up to 5)': 'Talent priorities',
  'Known narratives / recent events': 'Known narratives & recent events',
  'Report recipients (exactly one primary)': 'Report recipients',
};

export function BriefReviewForm({
  companyName,
  payload,
  onPatch: patch,
  variant = 'admin',
}: BriefReviewFormProps) {
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <FieldRow label={variant === 'client' ? (CLIENT_LABELS[label] ?? label) : label}>
      {children}
    </FieldRow>
  );
  return (
    <div className="space-y-5">
      <Field label="Employer entities (tracked separately get their own prompt set)">
        <EntityEditor
          companyName={companyName}
          entities={payload.employer_entities}
          onChange={(v) => patch({ employer_entities: v })}
          editable
          showHelp={variant === 'admin'}
          parentFunctions={payload.job_functions}
          parentMarkets={payload.markets}
          parentIndustries={payload.industries}
          trackLabel={variant === 'client' ? 'Report separately' : 'Track separately'}
        />
      </Field>

      <Field label="Job functions">
        <MultiChipSelect
          options={CANONICAL_JOB_FUNCTIONS}
          selected={payload.job_functions}
          onToggle={(v) => {
            const has = payload.job_functions.some(
              (x) => x.toLowerCase() === v.toLowerCase(),
            );
            patch({
              job_functions: has
                ? payload.job_functions.filter((x) => x.toLowerCase() !== v.toLowerCase())
                : [...payload.job_functions, v],
              // Keep per-market + industry mappings consistent with the master
              // list (mirrors the wizard) — with per-market scope the prompt
              // count is driven by market_functions, so a stale entry would
              // keep generating prompts for a removed function.
              market_functions: has
                ? payload.market_functions.map((m) => ({
                    ...m,
                    functions: m.functions.filter(
                      (x) => x.toLowerCase() !== v.toLowerCase(),
                    ),
                  }))
                : payload.market_functions,
              function_industries: has
                ? (payload.function_industries ?? []).filter(
                    (m) => m.function.toLowerCase() !== v.toLowerCase(),
                  )
                : payload.function_industries,
            });
          }}
          onAddCustom={(v) => patch({ job_functions: [...payload.job_functions, v] })}
          addPlaceholder="Add a function"
        />
      </Field>

      <Field label="Markets">
        <ChipAdder
          values={payload.markets}
          onChange={(v) =>
            patch({
              markets: v,
              // Drop mappings for removed markets; single market → uniform
              // (mirrors the wizard).
              market_functions: payload.market_functions.filter((m) =>
                v.includes(m.market),
              ),
              function_scope: v.length > 1 ? payload.function_scope : 'uniform',
            })
          }
          placeholder={`Add a market — e.g. ${Object.values(COUNTRY_NAMES)[0]}`}
        />
      </Field>

      {payload.markets.length > 1 && (
        <Field label="Functions by market">
          <div className="flex gap-2 mb-2">
            {(['uniform', 'per_market'] as const).map((v) => (
              <Button
                key={v}
                variant={payload.function_scope === v ? 'default' : 'outline'}
                size="sm"
                onClick={() => patch({ function_scope: v })}
              >
                {v === 'uniform' ? 'Same everywhere' : 'Different by market'}
              </Button>
            ))}
          </div>
          {payload.function_scope === 'per_market' && (
            <div className="space-y-2">
              {payload.markets.map((market) => {
                const entry = payload.market_functions.find((x) => x.market === market);
                const selected = entry?.functions ?? [];
                const setFns = (functions: string[]) =>
                  patch({
                    market_functions: [
                      ...payload.market_functions.filter((x) => x.market !== market),
                      { market, functions },
                    ],
                  });
                return (
                  <div key={market} className="rounded-md border border-slate-200 p-2.5">
                    <p className="text-xs font-medium text-slate-600 mb-1.5">{market}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {payload.job_functions.map((fn) => {
                        const on = selected.some(
                          (x) => x.toLowerCase() === fn.toLowerCase(),
                        );
                        return (
                          <Button
                            key={fn}
                            variant={on ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setFns(
                                on
                                  ? selected.filter(
                                      (x) => x.toLowerCase() !== fn.toLowerCase(),
                                    )
                                  : [...selected, fn],
                              )
                            }
                          >
                            {fn}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Field>
      )}

      <Field label="Talent competitors (context only — not competitor tracking)">
        <ChipAdder
          values={payload.talent_competitors}
          onChange={(v) => patch({ talent_competitors: v })}
          placeholder="Add a competitor"
        />
      </Field>

      <Field label="Industries">
        <ChipAdder
          values={payload.industries}
          onChange={(v) =>
            patch({
              industries: v,
              function_industries: (payload.function_industries ?? []).filter((m) =>
                v.some((i) => i.toLowerCase() === m.industry.toLowerCase()),
              ),
            })
          }
          placeholder="Add an industry"
        />
      </Field>

      {payload.industries.length > 1 && (
        <Field label="Industry by function (benchmark each function in its own industry)">
          <div className="space-y-2">
            {payload.job_functions.map((fn) => {
              const current =
                (payload.function_industries ?? []).find(
                  (m) => m.function.toLowerCase() === fn.toLowerCase(),
                )?.industry ?? payload.industries[0];
              return (
                <div key={fn} className="rounded-md border border-slate-200 p-2.5">
                  <p className="text-xs font-medium text-slate-600 mb-1.5">{fn}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.industries.map((ind) => (
                      <Button
                        key={ind}
                        variant={
                          current?.toLowerCase() === ind.toLowerCase()
                            ? 'default'
                            : 'outline'
                        }
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          patch({
                            function_industries: [
                              ...(payload.function_industries ?? []).filter(
                                (m) => m.function.toLowerCase() !== fn.toLowerCase(),
                              ),
                              { function: fn, industry: ind },
                            ],
                          })
                        }
                      >
                        {ind}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>
      )}

      <Field label="Career site URL">
        <Input
          value={payload.career_site_url}
          onChange={(e) => patch({ career_site_url: e.target.value })}
        />
      </Field>

      <Field label="Owned properties">
        <PropertyEditor
          properties={payload.owned_properties}
          onChange={(v) => patch({ owned_properties: v })}
          editable
        />
      </Field>

      <Field label="Managed review platforms">
        <MultiChipSelect
          options={MANAGED_PLATFORM_OPTIONS}
          selected={payload.managed_platforms}
          onToggle={(v) =>
            patch({
              managed_platforms: payload.managed_platforms.some(
                (x) => x.toLowerCase() === v.toLowerCase(),
              )
                ? payload.managed_platforms.filter(
                    (x) => x.toLowerCase() !== v.toLowerCase(),
                  )
                : [...payload.managed_platforms, v],
            })
          }
          onAddCustom={(v) => patch({ managed_platforms: [...payload.managed_platforms, v] })}
          addPlaceholder="Add a platform"
        />
      </Field>

      <Field label="Career-stage grain">
        <div className="flex gap-2">
          {(['combined', 'split'] as const).map((v) => (
            <Button
              key={v}
              variant={payload.career_stage_split === v ? 'default' : 'outline'}
              size="sm"
              onClick={() => patch({ career_stage_split: v })}
            >
              {v === 'combined' ? 'Combined' : 'Split by stage'}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Talent priorities (up to 5)">
        <PriorityEditor
          values={payload.ta_priorities}
          onChange={(v) => patch({ ta_priorities: v })}
          editable
        />
      </Field>

      <Field label="Leadership objective">
        <textarea
          value={payload.leadership_objective}
          onChange={(e) => patch({ leadership_objective: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Focus questions">
        <textarea
          value={payload.focus_questions}
          onChange={(e) => patch({ focus_questions: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Known narratives / recent events">
        <textarea
          value={payload.known_context}
          onChange={(e) => patch({ known_context: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Report recipients (exactly one primary)">
        <RecipientEditor
          recipients={payload.report_recipients}
          onChange={(v) => patch({ report_recipients: v })}
          editable
        />
      </Field>

      <Field label="Additional notes">
        <textarea
          value={payload.additional_notes}
          onChange={(e) => patch({ additional_notes: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </Field>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}
