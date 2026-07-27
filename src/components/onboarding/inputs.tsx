// Input widgets for the client onboarding. All controls are native
// buttons/inputs (keyboard reachable), with visible focus rings.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import {
  EmployerEntity,
  OWNED_PROPERTY_TYPES,
  OwnedProperty,
  OwnedPropertyType,
  ReportRecipient,
} from '@/lib/onboarding/types';

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2';

export function Chip({
  label,
  selected,
  onClick,
  variant = 'default',
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  variant?: 'default' | 'primary';
}) {
  const base = `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors border ${focusRing}`;
  const style =
    variant === 'primary'
      ? 'bg-nightsky text-white border-nightsky hover:bg-dusk'
      : selected
        ? 'bg-nightsky text-white border-nightsky'
        : 'bg-white text-nightsky border-silver hover:border-nightsky/40';
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`${base} ${style}`}>
      {label}
    </button>
  );
}

export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-nightsky text-white pl-3 pr-1.5 py-1 text-sm">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className={`rounded-full p-0.5 hover:bg-white/20 ${focusRing}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

export function ContinueButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full bg-pink text-white px-5 py-2 text-sm font-medium transition-colors hover:bg-pink/90 disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
    >
      {label}
    </button>
  );
}

export function SkipButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm text-slate-500 hover:text-nightsky underline-offset-4 hover:underline ${focusRing}`}
    >
      {label}
    </button>
  );
}

export const inputClass = `w-full rounded-xl border border-silver bg-white px-3.5 py-2.5 text-sm text-nightsky placeholder:text-slate-400 ${focusRing}`;

// In-place editing inside list rows (admin brief review): reads as plain text,
// reveals its border on hover/focus so typos can be fixed without re-adding.
const inlineInputClass =
  'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-nightsky placeholder:text-slate-400 hover:border-silver focus:border-teal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal';

/** "Press Enter" affordance shown inside adder inputs once there's text. */
function EnterHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400"
    >
      press
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] text-slate-500">
        Enter ↵
      </kbd>
      to add
    </span>
  );
}

// ---------------------------------------------------------------------------
// Multi-select chips with "add your own"
// ---------------------------------------------------------------------------

export function MultiChipSelect({
  options,
  selected,
  onToggle,
  onAddCustom,
  addPlaceholder,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  onAddCustom: (value: string) => void;
  addPlaceholder: string;
}) {
  const [custom, setCustom] = useState('');
  const customChips = selected.filter((s) => !options.some((o) => o.toLowerCase() === s.toLowerCase()));

  const add = () => {
    const v = custom.trim();
    if (v) {
      onAddCustom(v);
      setCustom('');
    }
  };

  return (
    <div className="space-y-3">
      {/* Selected chips carry an × and remove like market chips do; unselected
          options are tap-to-add. */}
      <div className="flex flex-wrap gap-2">
        {options.map((o) =>
          selected.some((s) => s.toLowerCase() === o.toLowerCase()) ? (
            <RemovableChip key={o} label={o} onRemove={() => onToggle(o)} />
          ) : (
            <Chip key={o} label={o} onClick={() => onToggle(o)} />
          ),
        )}
        {customChips.map((c) => (
          <RemovableChip key={c} label={c} onRemove={() => onToggle(c)} />
        ))}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={addPlaceholder}
            className={`${inputClass} ${custom.trim() ? 'sm:pr-32' : ''}`}
            aria-label={addPlaceholder}
          />
          <EnterHint show={!!custom.trim()} />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!custom.trim()}
          aria-label="Add"
          className={`shrink-0 rounded-xl border border-silver px-3 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Free-text chip adder (competitors, industries)
// ---------------------------------------------------------------------------

export function ChipAdder({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v]);
    }
    setText('');
  };
  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <RemovableChip key={v} label={v} onRemove={() => onChange(values.filter((x) => x !== v))} />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className={`${inputClass} ${text.trim() ? 'sm:pr-32' : ''}`}
            aria-label={placeholder}
          />
          <EnterHint show={!!text.trim()} />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          aria-label="Add"
          className={`shrink-0 rounded-xl border border-silver px-3 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markets: search over a country list + add your own
// ---------------------------------------------------------------------------

export function CountryPicker({
  countries,
  selected,
  onChange,
}: {
  countries: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return countries
      .filter((c) => c.toLowerCase().includes(q))
      .filter((c) => !selected.some((s) => s.toLowerCase() === c.toLowerCase()))
      .slice(0, 8);
  }, [query, countries, selected]);

  const exactMatch = countries.some((c) => c.toLowerCase() === query.trim().toLowerCase());
  const canAddCustom =
    query.trim().length > 1 &&
    !exactMatch &&
    !selected.some((s) => s.toLowerCase() === query.trim().toLowerCase());

  const add = (value: string) => {
    onChange([...selected, value]);
    setQuery('');
  };

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((v) => (
            <RemovableChip key={v} label={v} onRemove={() => onChange(selected.filter((x) => x !== v))} />
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (matches[0]) add(matches[0]);
              else if (canAddCustom) add(query.trim());
            }
          }}
          placeholder="Search countries or US states — e.g. Brazil, Texas"
          className={`${inputClass} ${query.trim() ? 'sm:pr-32' : ''}`}
          aria-label="Search countries or US states"
        />
        {(matches.length > 0 || canAddCustom) && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400"
          >
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] text-slate-500">
              Enter ↵
            </kbd>
            adds {matches[0] ?? `"${query.trim()}"`}
          </span>
        )}
      </div>
      {(matches.length > 0 || canAddCustom) && (
        <div className="flex flex-wrap gap-2">
          {matches.map((m) => (
            <Chip key={m} label={m} onClick={() => add(m)} />
          ))}
          {canAddCustom && (
            <Chip label={`Add "${query.trim()}"`} onClick={() => add(query.trim())} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employer entities
// ---------------------------------------------------------------------------

export function EntityEditor({
  companyName,
  entities,
  onChange,
  showHelp = true,
  editable = false,
  parentFunctions = [],
  parentMarkets = [],
  parentIndustries = [],
  trackLabel = 'Track separately',
}: {
  companyName: string;
  entities: EmployerEntity[];
  onChange: (entities: EmployerEntity[]) => void;
  /** The wizard's question hint already explains this; admin has no hint. */
  showHelp?: boolean;
  /**
   * Admin review: edit entity names in place, and open each tracked sub-brand's
   * scope (inherit the parent's roles/markets, or set its own). The wizard asks
   * for scope in its own per-entity step, so it leaves this off.
   */
  editable?: boolean;
  /** Parent's functions/markets — the options a custom scope narrows down from. */
  parentFunctions?: string[];
  parentMarkets?: string[];
  /** The brief's industries — offered as a per-entity benchmark override. */
  parentIndustries?: string[];
  /** Wording for the per-entity toggle — client-facing views say "Report separately". */
  trackLabel?: string;
}) {
  const [name, setName] = useState('');
  // One scope panel open at a time keeps a long brief readable. Index-keyed
  // (names are editable, so a name key would collapse mid-edit).
  const [openScope, setOpenScope] = useState<number | null>(null);

  const updateEntity = (i: number, patch: Partial<EmployerEntity>) => {
    const next = [...entities];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const toggleIn = (list: string[], value: string) =>
    list.some((x) => x.toLowerCase() === value.toLowerCase())
      ? list.filter((x) => x.toLowerCase() !== value.toLowerCase())
      : [...list, value];

  const add = () => {
    const v = name.trim();
    if (
      v &&
      v.toLowerCase() !== companyName.toLowerCase() &&
      !entities.some((e) => e.name.toLowerCase() === v.toLowerCase())
    ) {
      onChange([...entities, { name: v, track_separately: true }]);
    }
    setName('');
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {/* The invited company is always tracked — shown first, locked. */}
        <li className="flex items-center gap-3 rounded-xl border border-nightsky/15 bg-nightsky/[0.03] px-3 py-2">
          <span className="text-sm font-medium text-nightsky flex-1 truncate">{companyName}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-teal bg-teal/10 rounded-full px-2 py-0.5">
            Always tracked
          </span>
        </li>
      </ul>
      {entities.length > 0 && (
        <ul className="space-y-2">
          {entities.map((e, i) => {
            const custom = e.scope_mode === 'custom';
            const funcs = e.job_functions ?? [];
            const markets = e.markets ?? [];
            const scopeOpen = openScope === i;
            return (
              <li key={i} className="rounded-xl border border-silver bg-white px-3 py-2">
                <div className="flex items-center gap-3">
                  {editable ? (
                    <input
                      value={e.name}
                      onChange={(ev) => updateEntity(i, { name: ev.target.value })}
                      aria-label="Entity name"
                      className={`flex-1 min-w-0 ${inlineInputClass}`}
                    />
                  ) : (
                    <span className="text-sm text-nightsky flex-1 truncate">{e.name}</span>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={e.track_separately}
                      onChange={(ev) => updateEntity(i, { track_separately: ev.target.checked })}
                      className={`h-4 w-4 rounded border-silver accent-[#0CBCB9] ${focusRing}`}
                    />
                    {trackLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(entities.filter((_, j) => j !== i));
                      setOpenScope(null);
                    }}
                    aria-label={`Remove ${e.name}`}
                    className={`text-slate-400 hover:text-nightsky rounded p-0.5 ${focusRing}`}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {/* Scope: what this sub-brand actually hires for. Inheriting the
                    parent's full matrix is the default and can be far too wide. */}
                {editable && e.track_separately && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpenScope(scopeOpen ? null : i)}
                      aria-expanded={scopeOpen}
                      className={`flex items-center gap-1 rounded text-xs text-slate-500 hover:text-nightsky ${focusRing}`}
                    >
                      {scopeOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Scope:{' '}
                      <span className="font-medium text-slate-600">
                        {custom
                          ? `${funcs.length} function${funcs.length === 1 ? '' : 's'} · ${markets.length} market${markets.length === 1 ? '' : 's'}`
                          : `same as ${companyName || 'parent'}`}
                      </span>
                    </button>

                    {scopeOpen && (
                      <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex flex-wrap gap-2">
                          <Chip
                            label={`Same as ${companyName || 'parent'}`}
                            selected={!custom}
                            onClick={() => updateEntity(i, { scope_mode: 'inherit' })}
                          />
                          <Chip
                            label="Its own roles & markets"
                            selected={custom}
                            onClick={() =>
                              updateEntity(i, {
                                scope_mode: 'custom',
                                // Seed from the parent so narrowing is a few clicks.
                                job_functions: e.job_functions ?? [...parentFunctions],
                                markets: e.markets ?? [...parentMarkets],
                              })
                            }
                          />
                        </div>

                        {custom ? (
                          <>
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Functions
                              </p>
                              <MultiChipSelect
                                options={parentFunctions}
                                selected={funcs}
                                onToggle={(v) =>
                                  updateEntity(i, { job_functions: toggleIn(funcs, v) })
                                }
                                onAddCustom={(v) =>
                                  updateEntity(i, { job_functions: toggleIn(funcs, v) })
                                }
                                addPlaceholder="Add a function"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Markets
                              </p>
                              <MultiChipSelect
                                options={parentMarkets}
                                selected={markets}
                                onToggle={(v) => updateEntity(i, { markets: toggleIn(markets, v) })}
                                onAddCustom={(v) =>
                                  updateEntity(i, { markets: toggleIn(markets, v) })
                                }
                                addPlaceholder="Add a market"
                              />
                            </div>
                            {(funcs.length === 0 || markets.length === 0) && (
                              <p className="text-xs text-pink">
                                Pick at least one function and one market.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">
                            Covers every function in every market listed above. Switch to its
                            own roles &amp; markets if this one hires for fewer.
                          </p>
                        )}

                        {/* Industry is independent of role/market scope: a unit can
                            hire for the same roles yet compete against a different set. */}
                        {parentIndustries.length > 0 && (
                          <div className="space-y-1.5 border-t border-slate-200 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Industry
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <Chip
                                label="Same as the brief"
                                selected={!e.industry}
                                onClick={() => updateEntity(i, { industry: undefined })}
                              />
                              {parentIndustries.map((ind) => (
                                <Chip
                                  key={ind}
                                  label={ind}
                                  selected={e.industry?.toLowerCase() === ind.toLowerCase()}
                                  onClick={() => updateEntity(i, { industry: ind })}
                                />
                              ))}
                            </div>
                            <p className="text-xs text-slate-500">
                              {e.industry
                                ? `Everything for ${e.name || 'this one'} is compared against ${e.industry}.`
                                : 'Uses whichever industry each function is set to.'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Entity or brand name — e.g. Frito-Lay"
            className={`${inputClass} ${name.trim() ? 'sm:pr-32' : ''}`}
            aria-label="Entity name"
          />
          <EnterHint show={!!name.trim()} />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          aria-label="Add entity"
          className={`shrink-0 rounded-xl border border-silver px-3 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {showHelp && (
        <p className="text-xs text-slate-500">
          Divisions, subsidiaries or brands people apply to in their own right — each one tracked
          separately gets its own results.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owned properties
// ---------------------------------------------------------------------------

export function PropertyEditor({
  properties,
  onChange,
  editable = false,
}: {
  properties: OwnedProperty[];
  onChange: (properties: OwnedProperty[]) => void;
  /** Admin review: edit type + URL in place instead of remove + re-add. */
  editable?: boolean;
}) {
  const [type, setType] = useState<OwnedPropertyType>('linkedin');
  const [url, setUrl] = useState('');
  const add = () => {
    const v = url.trim();
    if (v && !properties.some((p) => p.url.toLowerCase() === v.toLowerCase())) {
      onChange([...properties, { type, url: v }]);
      setUrl('');
    }
  };

  return (
    <div className="space-y-3">
      {properties.length > 0 && (
        <ul className="space-y-2">
          {properties.map((p, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-xl border border-silver bg-white px-3 py-2 text-sm"
            >
              {editable ? (
                <>
                  <select
                    value={p.type}
                    onChange={(ev) => {
                      const next = [...properties];
                      next[i] = { ...p, type: ev.target.value as OwnedPropertyType };
                      onChange(next);
                    }}
                    aria-label="Property type"
                    className="w-28 shrink-0 rounded-md border border-transparent bg-transparent py-1 text-xs uppercase tracking-wide text-slate-500 hover:border-silver focus:border-teal focus-visible:outline-none"
                  >
                    {OWNED_PROPERTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={p.url}
                    onChange={(ev) => {
                      const next = [...properties];
                      next[i] = { ...p, url: ev.target.value };
                      onChange(next);
                    }}
                    aria-label="Property URL"
                    className={`flex-1 min-w-0 ${inlineInputClass}`}
                  />
                </>
              ) : (
                <>
                  <span className="text-xs uppercase tracking-wide text-slate-500 w-24 shrink-0">
                    {OWNED_PROPERTY_TYPES.find((t) => t.value === p.type)?.label ?? p.type}
                  </span>
                  <span className="text-nightsky flex-1 truncate">{p.url}</span>
                </>
              )}
              <button
                type="button"
                onClick={() => onChange(properties.filter((_, j) => j !== i))}
                aria-label={`Remove ${p.url}`}
                className={`text-slate-400 hover:text-nightsky rounded p-0.5 ${focusRing}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as OwnedPropertyType)}
          aria-label="Property type"
          className={`rounded-xl border border-silver bg-white px-3 py-2.5 text-sm text-nightsky sm:w-40 ${focusRing}`}
        >
          {OWNED_PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="URL — e.g. linkedin.com/company/…"
            className={`${inputClass} ${url.trim() ? 'sm:pr-32' : ''}`}
            aria-label="Property URL"
          />
          <EnterHint show={!!url.trim()} />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!url.trim()}
          aria-label="Add property"
          className={`shrink-0 rounded-xl border border-silver px-3 py-2 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report recipients
// ---------------------------------------------------------------------------

const emailLooksValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export function RecipientEditor({
  recipients,
  onChange,
  editable = false,
}: {
  recipients: ReportRecipient[];
  onChange: (recipients: ReportRecipient[]) => void;
  /** Admin review: edit name/role/email in place instead of remove + re-add. */
  editable?: boolean;
}) {
  const [draft, setDraft] = useState({ name: '', role: '', email: '' });

  const add = () => {
    if (!draft.name.trim() || !emailLooksValid(draft.email)) return;
    const next: ReportRecipient = {
      name: draft.name.trim(),
      role: draft.role.trim(),
      email: draft.email.trim().toLowerCase(),
      is_primary: recipients.length === 0,
    };
    onChange([...recipients, next]);
    setDraft({ name: '', role: '', email: '' });
  };

  const setPrimary = (idx: number) =>
    onChange(recipients.map((r, i) => ({ ...r, is_primary: i === idx })));

  return (
    <div className="space-y-3">
      {recipients.length > 0 && (
        <ul className="space-y-2" role="radiogroup" aria-label="Primary recipient">
          {recipients.map((r, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-xl border border-silver bg-white px-3 py-2"
            >
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer shrink-0">
                <input
                  type="radio"
                  name="primary-recipient"
                  checked={r.is_primary}
                  onChange={() => setPrimary(i)}
                  className={`h-4 w-4 accent-[#DB5E89] ${focusRing}`}
                />
                Primary
              </label>
              {editable ? (
                <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.4fr] gap-1.5">
                  <input
                    value={r.name}
                    onChange={(ev) => {
                      const next = [...recipients];
                      next[i] = { ...r, name: ev.target.value };
                      onChange(next);
                    }}
                    placeholder="Name"
                    aria-label="Recipient name"
                    className={inlineInputClass}
                  />
                  <input
                    value={r.role}
                    onChange={(ev) => {
                      const next = [...recipients];
                      next[i] = { ...r, role: ev.target.value };
                      onChange(next);
                    }}
                    placeholder="Role"
                    aria-label="Recipient role"
                    className={inlineInputClass}
                  />
                  <input
                    value={r.email}
                    onChange={(ev) => {
                      const next = [...recipients];
                      next[i] = { ...r, email: ev.target.value };
                      onChange(next);
                    }}
                    placeholder="Email"
                    type="email"
                    aria-label="Recipient email"
                    className={inlineInputClass}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-nightsky truncate">
                    {r.name}
                    {r.role ? <span className="text-slate-500"> · {r.role}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{r.email}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  const next = recipients.filter((_, j) => j !== i);
                  if (r.is_primary && next.length > 0 && !next.some((x) => x.is_primary)) {
                    next[0] = { ...next[0], is_primary: true };
                  }
                  onChange(next);
                }}
                aria-label={`Remove ${r.name}`}
                className={`text-slate-400 hover:text-nightsky rounded p-0.5 ${focusRing}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.2fr_auto] gap-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name"
          className={inputClass}
          aria-label="Recipient name"
        />
        <input
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          placeholder="Role"
          className={inputClass}
          aria-label="Recipient role"
        />
        <input
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Email"
          type="email"
          className={inputClass}
          aria-label="Recipient email"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.name.trim() || !emailLooksValid(draft.email)}
          aria-label="Add recipient"
          className={`rounded-xl border border-silver px-3 py-2 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {(draft.name.trim() || draft.email.trim()) && (
        <p className="text-xs text-slate-400">
          Fill in name and email, then press{' '}
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-500">
            Enter ↵
          </kbd>{' '}
          or the + to add them.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Priorities (up to 5 short rows)
// ---------------------------------------------------------------------------

export function PriorityEditor({
  values,
  onChange,
  max = 5,
  editable = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  max?: number;
  /** Admin review: edit priority text in place instead of remove + re-add. */
  editable?: boolean;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (v && values.length < max && !values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v]);
      setText('');
    }
  };
  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <ol className="space-y-2 list-none">
          {values.map((v, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-xl border border-silver bg-white px-3 py-2 text-sm text-nightsky"
            >
              <span className="w-5 h-5 shrink-0 rounded-full bg-teal/15 text-teal text-xs flex items-center justify-center font-medium">
                {i + 1}
              </span>
              {editable ? (
                <input
                  value={v}
                  onChange={(ev) => {
                    const next = [...values];
                    next[i] = ev.target.value;
                    onChange(next);
                  }}
                  aria-label={`Priority ${i + 1}`}
                  className={`flex-1 min-w-0 ${inlineInputClass}`}
                />
              ) : (
                <span className="flex-1 truncate">{v}</span>
              )}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                aria-label={`Remove ${v}`}
                className={`text-slate-400 hover:text-nightsky rounded p-0.5 ${focusRing}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      {values.length < max && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={`Priority ${values.length + 1} of up to ${max}`}
              className={`${inputClass} ${text.trim() ? 'sm:pr-32' : ''}`}
              aria-label="Add a priority"
            />
            <EnterHint show={!!text.trim()} />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!text.trim()}
            aria-label="Add priority"
            className={`shrink-0 rounded-xl border border-silver px-3 text-nightsky hover:border-nightsky/40 disabled:opacity-40 ${focusRing}`}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
