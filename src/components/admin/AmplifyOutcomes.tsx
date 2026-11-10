// Amplify outcomes: what happened after people opened a link.
//
// We never learn whether anyone wrote a review; no platform tells us, and the
// recipient page promises we don't look. So this shows what the page records
// on its own: the funnel step by step, which platforms were shown vs opened vs
// clicked, time away after a click (bucketed), and shares. Breakdowns are
// withheld server-side below 5 people who picked a country.
//
// Raw counts are fine here (admin only). Anything that goes to a client is
// quoted as a percentage and signed off by Karim.

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { platformName } from '@/pages/Activate';
import { ActivateLink, AmplifyLinkInsights } from '@/lib/activate/api';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');

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
