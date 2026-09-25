import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getFavicon } from '@/utils/citationUtils';

// Where each client's mark comes from, best first:
//   1. The logo uploaded in Activate branding
//   2. The logo domain set in Activate branding
//   3. organizations.logo_url
//   4. The org's own domains (company_owned_domains, corporate first)
//   5. A company website shared by most of the org's companies (so a demo
//      org full of unrelated brands doesn't borrow one of theirs)
// and otherwise the org's initials.

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** careers.emsteel.com → emsteel.com, www.pepsico.com.br → pepsico.com.br */
export const registrableDomain = (raw: string): string => {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = last.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
};

const ASSET_RANK: Record<string, number> = { corporate: 0, product: 1, careers: 2 };

export const useOrgLogos = (orgs: { id: string; logo_url?: string | null }[]) => {
  const [logos, setLogos] = useState<Record<string, string>>({});
  const key = orgs.map((o) => o.id).join(',');

  useEffect(() => {
    if (orgs.length === 0) return;
    let cancelled = false;
    (async () => {
      const [branding, links, owned] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('activate_branding').select('org_id, logo_url, logo_domain'),
        supabase
          .from('organization_companies')
          .select('organization_id, company_id, companies(website)')
          .range(0, 49999),
        supabase.from('company_owned_domains').select('company_id, domain, asset_type').range(0, 49999),
      ]);
      if (cancelled) return;

      const brandByOrg = new Map<string, { logo_url: string | null; logo_domain: string | null }>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((branding.data ?? []) as any[]).map((b) => [b.org_id, b]),
      );
      const ownedByCompany = new Map<string, { domain: string; asset_type: string | null }[]>();
      for (const d of owned.data ?? []) {
        const list = ownedByCompany.get(d.company_id) ?? [];
        list.push(d);
        ownedByCompany.set(d.company_id, list);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const linksByOrg = new Map<string, any[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const l of (links.data ?? []) as any[]) {
        const list = linksByOrg.get(l.organization_id) ?? [];
        list.push(l);
        linksByOrg.set(l.organization_id, list);
      }

      const next: Record<string, string> = {};
      for (const org of orgs) {
        const brand = brandByOrg.get(org.id);
        if (brand?.logo_url) { next[org.id] = brand.logo_url; continue; }
        if (brand?.logo_domain) { next[org.id] = getFavicon(registrableDomain(brand.logo_domain), 128); continue; }
        if (org.logo_url) { next[org.id] = org.logo_url; continue; }

        const orgLinks = linksByOrg.get(org.id) ?? [];
        const ownedDomains = orgLinks
          .flatMap((l) => ownedByCompany.get(l.company_id) ?? [])
          .sort((a, b) => (ASSET_RANK[a.asset_type ?? ''] ?? 9) - (ASSET_RANK[b.asset_type ?? ''] ?? 9));
        if (ownedDomains.length > 0) {
          next[org.id] = getFavicon(registrableDomain(ownedDomains[0].domain), 128);
          continue;
        }

        const counts = new Map<string, number>();
        for (const l of orgLinks) {
          const site = l.companies?.website;
          if (site) counts.set(registrableDomain(site), (counts.get(registrableDomain(site)) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > orgLinks.length / 2) next[org.id] = getFavicon(top[0], 128);
      }
      setLogos(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return logos;
};

const initials = (name: string) =>
  name
    .replace(/'s organization$/i, '')
    .split(/[\s,]+/)
    .filter((w) => /^[a-z0-9]/i.test(w) && !/^(inc|ltd|llc|the)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

const SIZES = {
  sm: 'h-7 w-7 text-[10px] rounded-md',
  md: 'h-10 w-10 text-xs rounded-lg',
  lg: 'h-12 w-12 text-sm rounded-xl',
};

export const OrgLogo = ({ name, src, size = 'md' }: { name: string; src?: string; size?: keyof typeof SIZES }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const box = `${SIZES[size]} shrink-0 border flex items-center justify-center overflow-hidden`;

  if (src && !failed) {
    return (
      <span className={`${box} border-slate-200 bg-white`}>
        <img src={src} alt="" className="h-full w-full object-contain p-1" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className={`${box} bg-pink/10 border-pink/20 font-semibold text-pink`}>{initials(name) || '?'}</span>;
};
