// Amplify outcomes: what happened after people opened a link.
//
// We never learn whether anyone wrote a review; no platform tells us, and the
// recipient page promises we don't look. So this screen shows the two honest
// substitutes:
//
//   1. How links compare: the funnel step by step, which platforms were shown
//      vs opened vs clicked, time away after a click (bucketed), and shares.
//      Breakdowns are withheld server-side below 5 people who picked a country.
//   2. Review counts: the public review total on each destination profile,
//      entered by hand every week or two, with growth before vs after the
//      first link went out. Never scraped (Glassdoor and Indeed forbid it).
//
// Raw counts are fine here (admin only). Anything that goes to a client is
// quoted as a percentage change and signed off by Karim.

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { platformName } from '@/pages/Activate';
import {
  ActivateAdminRoute,
  ActivateLink,
  AmplifyLinkInsights,
  AmplifyWeeklyClicks,
  countryName,
  deleteReviewSnapshot,
  ReviewSnapshot,
  reviewGrowthAround,
  saveReviewSnapshot,
} from '@/lib/activate/api';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');
const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

// ---------------------------------------------------------------------------
// 1. How links compare
// ---------------------------------------------------------------------------

export function LinkComparison({
  links,
  insights,
}: {
  links: ActivateLink[];
  insights: Record<string, AmplifyLinkInsights>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = links.filter((l) => insights[l.id]);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">How links compare</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every rate is out of the people who picked a country, the first step a bot can't fake.
          "Came back after 2 min+" is a rough sign that someone spent time on the platform; we
          can't see what they did there. Open a row for each step and each platform.
        </p>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium p-2.5">Link</th>
              <th className="text-right font-medium p-2.5">Picked a country</th>
              <th className="text-right font-medium p-2.5">Saw options</th>
              <th className="text-right font-medium p-2.5">Opened a platform card</th>
              <th className="text-right font-medium p-2.5">Clicked through</th>
              <th className="text-right font-medium p-2.5">Came back after 2 min+</th>
              <th className="text-right font-medium p-2.5">Shared the page</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((link) => {
              const s = insights[link.id];
              const f = s.funnel;
              const base = f.market_declared;
              const longAway = s.away ? s.away['2m_to_10m'] + s.away.over_10m : null;
              const open = openId === link.id;
              return (
                <Fragment key={link.id}>
                  <tr
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                    onClick={() => setOpenId(open ? null : link.id)}
                  >
                    <td className="p-2.5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {link.label}
                      </span>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{base}</td>
                    {s.suppressed ? (
                      <td colSpan={5} className="p-2.5 text-right text-muted-foreground">
                        Under 5 people so far, rates shown once there are more
                      </td>
                    ) : (
                      <>
                        <td className="p-2.5 text-right tabular-nums">{pct(f.routes_shown, base)}</td>
                        <td className="p-2.5 text-right tabular-nums">{pct(f.platform_expanded, base)}</td>
                        <td className="p-2.5 text-right tabular-nums font-medium">{pct(f.platform_click, base)}</td>
                        <td className="p-2.5 text-right tabular-nums">
                          {longAway === null ? '–' : pct(longAway, f.platform_click)}
                          <span className="text-muted-foreground"> of clickers</span>
                        </td>
                        <td className="p-2.5 text-right tabular-nums">{pct(s.shares.sessions, base)}</td>
                      </>
                    )}
                  </tr>
                  {open && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={7} className="p-3">
                        <LinkDetail insights={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Saw options, opened a card, came back and shared only record from the November 2026
        update onwards, so links with older visits show lower rates for those four.
      </p>
    </div>
  );
}

function LinkDetail({ insights }: { insights: AmplifyLinkInsights }) {
  const f = insights.funnel;
  const steps: Array<[string, number]> = [
    ['Opened the link (includes email-scanner bots)', f.open],
    ['Picked a country', f.market_declared],
    ['Picked a division', f.entity_declared],
    ['Answered the profile question', f.profile_declared],
    ['Saw their options', f.routes_shown],
    ['Opened a platform card', f.platform_expanded],
    ['Clicked through to a platform', f.platform_click],
    ['Came back to the page afterwards', f.platform_return],
  ];
  const platforms = insights.platforms
    ? Object.entries(insights.platforms).sort((a, b) => b[1].clicked - a[1].clicked || b[1].shown - a[1].shown)
    : [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Step by step</p>
        <table className="w-full">
          <tbody>
            {steps.map(([label, n]) => (
              <tr key={label}>
                <td className="py-0.5">{label}</td>
                <td className="py-0.5 text-right tabular-nums">{n}</td>
                <td className="py-0.5 pl-3 text-right tabular-nums text-muted-foreground w-14">
                  {label.startsWith('Opened the link') ? '' : pct(n, f.market_declared)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-0.5">
                Shared the page
                <span className="text-muted-foreground">
                  {' '}({insights.shares.native} share sheet, {insights.shares.copy} copied)
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums">{insights.shares.sessions}</td>
              <td className="py-0.5 pl-3 text-right tabular-nums text-muted-foreground">
                {pct(insights.shares.sessions, f.market_declared)}
              </td>
            </tr>
          </tbody>
        </table>
        {insights.away && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-3 mb-1.5">
              Time away after a click
            </p>
            <p>
              Under 30s {insights.away.under_30s} · 30s to 2 min {insights.away['30s_to_2m']} · 2 to 10
              min {insights.away['2m_to_10m']} · over 10 min {insights.away.over_10m}
            </p>
            <p className="text-muted-foreground mt-1">
              Someone who never comes back to the page isn't counted here, so this undercounts.
            </p>
          </>
        )}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">By platform</p>
        {insights.suppressed ? (
          <p className="text-muted-foreground">Shown once 5 people have picked a country.</p>
        ) : platforms.length === 0 ? (
          <p className="text-muted-foreground">No platform activity yet.</p>
        ) : (
          <table className="w-full">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-medium py-0.5">Platform</th>
                <th className="text-right font-medium py-0.5">Shown</th>
                <th className="text-right font-medium py-0.5">Opened</th>
                <th className="text-right font-medium py-0.5">Clicked</th>
                <th className="text-right font-medium py-0.5">Click rate</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map(([key, p]) => (
                <tr key={key}>
                  <td className="py-0.5">{platformName(key)}</td>
                  <td className="py-0.5 text-right tabular-nums">{p.shown}</td>
                  <td className="py-0.5 text-right tabular-nums">{p.expanded}</td>
                  <td className="py-0.5 text-right tabular-nums">{p.clicked}</td>
                  <td className="py-0.5 text-right tabular-nums">{pct(p.clicked, p.shown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Review counts on each platform
// ---------------------------------------------------------------------------

interface Profile {
  url: string;
  platform: string;
  market: string | null;
}

export function ReviewTracker({
  orgId,
  routes,
  links,
  snapshots,
  weekly,
  onSaved,
}: {
  orgId: string;
  routes: ActivateAdminRoute[];
  links: ActivateLink[];
  snapshots: ReviewSnapshot[];
  weekly: AmplifyWeeklyClicks | null;
  onSaved: () => void;
}) {
  // One profile per destination page people are sent to write reviews on.
  const profiles = useMemo(() => {
    const seen = new Map<string, Profile>();
    for (const r of routes) {
      if (r.channel !== 'review' || !r.active || r.is_listen_only) continue;
      if (!seen.has(r.destination_url)) {
        seen.set(r.destination_url, { url: r.destination_url, platform: r.platform, market: r.market_code });
      }
    }
    // Profiles with counts but no longer routed stay visible.
    for (const s of snapshots) {
      if (!seen.has(s.profile_url)) {
        seen.set(s.profile_url, { url: s.profile_url, platform: s.platform, market: s.market_code });
      }
    }
    return [...seen.values()].sort(
      (a, b) =>
        (a.market ?? 'ZZ').localeCompare(b.market ?? 'ZZ') || a.platform.localeCompare(b.platform),
    );
  }, [routes, snapshots]);

  const routedMarkets = useMemo(
    () => new Set(routes.map((r) => r.market_code).filter(Boolean) as string[]),
    [routes],
  );
  const launch = useMemo(
    () => (links.length ? [...links].sort((a, b) => a.created_at.localeCompare(b.created_at))[0].created_at : null),
    [links],
  );
  const linkDates = useMemo(
    () => [...new Set(links.map((l) => l.created_at.slice(0, 10)))].sort(),
    [links],
  );

  if (profiles.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Reviews on each platform</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          We can't see who writes a review, so we count them on the platform instead. Every week
          or two, open each profile, type in the total number of reviews it shows, and save.
          Growth after the first link
          {launch ? ` (${new Date(launch).toLocaleDateString()})` : ''} compared with before is the
          measure. Enter counts by hand only: Glassdoor and Indeed don't allow automated
          collection. For a client, quote the change as a percentage.
        </p>
      </div>
      <div className="rounded-lg border divide-y">
        {profiles.map((p) => (
          <ProfileRow
            key={p.url}
            orgId={orgId}
            profile={p}
            snaps={snapshots.filter((s) => s.profile_url === p.url)}
            launch={launch}
            linkDates={linkDates}
            clicks={
              weekly && !weekly.suppressed
                ? weekly.rows.filter(
                    (w) =>
                      w.platform === p.platform &&
                      (p.market
                        ? w.market_code === p.market
                        : !w.market_code || !routedMarkets.has(w.market_code)),
                  )
                : null
            }
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}

function growthLabel(perWeek: number | null) {
  if (perWeek === null) return 'not enough counts yet';
  return `${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(1)} a week`;
}

function ProfileRow({
  orgId,
  profile,
  snaps,
  launch,
  linkDates,
  clicks,
  onSaved,
}: {
  orgId: string;
  profile: Profile;
  snaps: ReviewSnapshot[];
  launch: string | null;
  linkDates: string[];
  clicks: AmplifyWeeklyClicks['rows'] | null;
  onSaved: () => void;
}) {
  const [count, setCount] = useState('');
  const [rating, setRating] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const latest = snaps[snaps.length - 1];
  const growth = launch ? reviewGrowthAround(snaps, launch) : null;
  const change =
    growth && growth.before !== null && growth.after !== null && growth.before > 0
      ? Math.round(((growth.after - growth.before) / growth.before) * 100)
      : null;

  const save = async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) {
      toast.error('Enter the total number of reviews as a whole number');
      return;
    }
    const r = rating.trim() === '' ? null : Number(rating);
    if (r !== null && (Number.isNaN(r) || r < 0 || r > 5)) {
      toast.error('Rating should be between 0 and 5, or left blank');
      return;
    }
    setSaving(true);
    try {
      await saveReviewSnapshot({
        orgId,
        platform: profile.platform,
        marketCode: profile.market,
        profileUrl: profile.url,
        reviewCount: n,
        rating: r,
        capturedOn: date,
      });
      setCount('');
      setRating('');
      toast.success(`Saved ${platformName(profile.platform)} count for ${shortDate(date)}`);
      onSaved();
    } catch {
      toast.error('Could not save the count');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteReviewSnapshot(id);
      onSaved();
    } catch {
      toast.error('Could not remove that count');
    }
  };

  // A time axis, so link dates fall between counts rather than needing a
  // count taken on the same day.
  const countSeries = snaps.map((s) => ({ t: Date.parse(s.captured_on), reviews: s.review_count }));
  const tMin = countSeries.length ? countSeries[0].t : 0;
  const tMax = countSeries.length ? countSeries[countSeries.length - 1].t : 0;
  const markers = linkDates.map((d) => Date.parse(d)).filter((t) => t >= tMin && t <= tMax);
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  const clickSeries = (clicks ?? []).reduce<Record<string, number>>((acc, w) => {
    acc[w.week] = (acc[w.week] ?? 0) + w.sessions;
    return acc;
  }, {});
  const clickRows = Object.entries(clickSeries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, sessions]) => ({ week, sessions }));

  return (
    <div className="p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 flex-wrap">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className="text-sm font-medium">{platformName(profile.platform)}</span>
            <Badge variant="outline" className="text-[10px]">
              {profile.market ? countryName(profile.market) : 'Everywhere else'}
            </Badge>
            {change !== null && (
              <Badge className={change >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                {change >= 0 ? '+' : ''}
                {change}% review pace since launch
              </Badge>
            )}
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5 truncate">
            {latest
              ? `${latest.review_count.toLocaleString()} reviews on ${shortDate(latest.captured_on)}${latest.rating !== null ? `, rated ${latest.rating}` : ''}`
              : 'No counts yet'}
            {growth && ` · before: ${growthLabel(growth.before)} · since: ${growthLabel(growth.after)}`}
          </span>
        </button>
        <a
          href={profile.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline underline-offset-2 text-muted-foreground"
        >
          Open profile
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="Total reviews"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="h-8 w-32 text-xs"
          aria-label={`Total reviews on ${platformName(profile.platform)}`}
        />
        <Input
          type="number"
          step="0.1"
          min={0}
          max={5}
          placeholder="Rating (optional)"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="h-8 w-36 text-xs"
          aria-label="Star rating shown on the profile"
        />
        <Input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 w-40 text-xs"
          aria-label="Date counted"
        />
        <Button size="sm" className="h-8" onClick={save} disabled={saving || count === ''}>
          Save count
        </Button>
      </div>

      {open && (
        <div className="grid gap-4 md:grid-cols-2 pt-1">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Total reviews on the profile
            </p>
            {countSeries.length < 2 ? (
              <p className="text-xs text-muted-foreground">Two or more counts draw the line.</p>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={countSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="0" vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(t) => shortDate(dayOf(Number(t)))}
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={['dataMin', 'dataMax']} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(t) => shortDate(dayOf(Number(t)))}
                      formatter={(v) => [Number(v).toLocaleString(), 'Reviews']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {markers.map((t) => (
                      <ReferenceLine key={t} x={t} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    ))}
                    <Line type="monotone" dataKey="reviews" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              Dashed lines mark the days links were created.
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              People who clicked through to it, by week
            </p>
            {clicks === null ? (
              <p className="text-xs text-muted-foreground">
                Shown once 5 people across this client's links have picked a country.
              </p>
            ) : clickRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No clicks to this platform here yet.</p>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clickRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="week" tickFormatter={shortDate} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(d) => `Week of ${shortDate(String(d))}`}
                      formatter={(v) => [v, 'People']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="sessions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {snaps.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Counts entered</p>
              <div className="flex flex-wrap gap-1.5">
                {[...snaps].reverse().map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
                    {shortDate(s.captured_on)}: {s.review_count.toLocaleString()}
                    <button
                      type="button"
                      onClick={() => remove(s.id)}
                      title="Remove this count"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
