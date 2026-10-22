// ─── Quarterly update email: template ───────────────────────────────────────
// Renders a DigestPayload to email HTML. Tables and inline styles only (Gmail
// drops <style> classes), one <style> block for the mobile stack as a
// progressive enhancement, system fonts, a hidden preheader. Marks come from
// logo.dev with the publishable key (the dashboard's lookup); attribute icons
// are the dashboard's Lucide marks rendered to PNG under /email/attributes.

import type {
  DigestAttributeRow, DigestBarRow, DigestGroupRow, DigestMetric, DigestPayload, DigestRenderOptions,
} from './types.ts';

const F = 'font-family:Helvetica,Arial,sans-serif;';
const NAVY = '#13274F', PINK = '#DB5E89', TEAL = '#0CBCB9', INK = '#0F172A', MUTED = '#64748B', BODY = '#475569';
const LINE = 'rgba(15,23,42,0.10)';
const UPBG = '#ECFDF3', UPFG = '#16A34A', DNBG = '#FEF3F2', DNFG = '#DC2626', FLBG = '#F1F5F9', FLFG = '#64748B';
const DOT = ' · ';

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const p = (text: string, size = 14, color = INK, weight = 400, extra = '', lh = '1.5') =>
  `<p style="${F}font-size:${size}px;line-height:${lh};color:${color};font-weight:${weight};margin:0;${extra}">${text}</p>`;

const pctText = (v: number | null) => v === null ? '–' : `${v}%`;

function pill(delta: number | null, previousLabel: string | null, hiddenText: string | null = null): string {
  let bg = FLBG, fg = FLFG, txt: string;
  if (hiddenText) txt = `▬ ${hiddenText}`;
  else if (delta === null) txt = '▬ first collection';
  else if (delta === 0) txt = '▬ no change';
  else {
    [bg, fg] = delta > 0 ? [UPBG, UPFG] : [DNBG, DNFG];
    txt = `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} pts${previousLabel ? ` vs ${previousLabel}` : ''}`;
  }
  return `<span style="${F}font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;display:inline-block;background-color:${bg};color:${fg};">${txt}</span>`;
}

function chg(delta: number | null): string {
  if (delta === null) return `<span style="color:${FLFG};font-weight:600;">–</span>`;
  const c = delta > 0 ? UPFG : delta < 0 ? DNFG : FLFG;
  const s = delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${-delta}` : '▬ 0';
  return `<span style="color:${c};font-weight:600;">${s}</span>`;
}

export function logoUrl(domain: string, token: string, size = 64): string {
  const clean = domain.trim().toLowerCase().replace(/^www\./, '');
  return `https://img.logo.dev/${encodeURIComponent(clean)}?token=${encodeURIComponent(token)}&amp;size=${size}&amp;format=png&amp;fallback=monogram`;
}

function mark(domain: string, token: string, size = 18): string {
  return `<span style="background-color:#ffffff;border:1px solid ${LINE};border-radius:4px;display:inline-block;line-height:0;padding:2px;vertical-align:middle;">` +
    `<img alt="" height="${size}" width="${size}" src="${logoUrl(domain, token)}" style="display:block;border:0;border-radius:3px;background:#fff;"></span>`;
}

function attributeLabel(row: DigestAttributeRow, appUrl: string): string {
  return `<img alt="" width="16" height="16" src="${appUrl}/email/attributes/${row.attributeId}.png" style="display:inline-block;vertical-align:-3px;border:0;margin-right:7px;">${escapeHtml(row.name)}`;
}

function metricCard(label: string, value: string, sub: string, grade?: string): string {
  const g = grade
    ? ` <span style="${F}font-size:11px;font-weight:700;color:#fff;background:${PINK};padding:2px 7px;border-radius:999px;vertical-align:middle;position:relative;top:-3px;">${grade}</span>`
    : '';
  return `<div class="em-metric-card" style="background-color:#FFFFFF;border-radius:10px;border:1px solid ${LINE};box-sizing:border-box;height:118px;padding:14px 16px;">` +
    p(label, 11, MUTED, 600, 'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;', '24px') +
    p(value + g, 26, INK, 700, 'letter-spacing:-0.5px;margin-bottom:8px;', '1.1') + sub + '</div>';
}

const metricRow = (a: string, b: string) =>
  `<tr><td class="em-stack" style="width:50%;vertical-align:top;padding-left:0;padding-right:5px;">${a}</td>` +
  `<td class="em-stack" style="width:50%;vertical-align:top;padding-left:5px;padding-right:0;">${b}</td></tr>`;

function barRow(row: DigestBarRow, token: string): string {
  const fg = row.you ? PINK : INK;
  const bg = row.you ? '#FDF2F6' : '#FFFFFF';
  const fill = row.you ? PINK : row.owned ? NAVY : '#94A3B8';
  const change = row.delta === null ? '' :
    `<span style="${F}font-size:11px;font-weight:600;color:${row.delta > 0 ? UPFG : row.delta < 0 ? DNFG : FLFG};margin-left:8px;">` +
    `${row.delta > 0 ? `↑ ${row.delta}` : row.delta < 0 ? `↓ ${-row.delta}` : '▬ 0'}</span>`;
  const width = Math.min(100, Math.max(row.pct, 1));
  return `<tr><td style="border-radius:7px;padding:9px 12px;vertical-align:middle;background-color:${bg};">` +
    `<table style="border-collapse:collapse;border-spacing:0;width:100%;"><tr>` +
    `<td align="center" style="padding-right:7px;text-align:center;vertical-align:middle;width:24px;" valign="middle">${mark(row.domain, token)}</td>` +
    `<td style="vertical-align:middle;width:100%;">${p(escapeHtml(row.name) + (row.you ? ' (You)' : ''), 12, fg, 600, '', '18px')}</td>` +
    `<td style="text-align:right;vertical-align:middle;white-space:nowrap;width:1%;">${p(`${row.pct}%` + change, 12, fg, 600, '', '24px')}</td></tr></table>` +
    `<table style="background-color:rgba(15,23,42,0.08);border-collapse:separate;border-radius:999px;border-spacing:0;margin-top:7px;width:100%;"><tr>` +
    `<td style="font-size:0;height:4px;line-height:0;background-color:${fill};border-radius:999px;width:${width}%;">&nbsp;</td>` +
    `<td style="font-size:0;height:4px;line-height:0;width:${100 - width}%;">&nbsp;</td></tr></table></td></tr>`;
}

const barList = (rows: string[]) =>
  `<table style="width:100%;border-collapse:separate;border-spacing:0 5px;">${rows.join('')}</table>`;

function section(title: string, sub: string, body: string, top = 20): string {
  return `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:${top}px;border-top:1px solid ${LINE};"><tbody><tr><td style="padding-top:18px;">` +
    p(title, 14, INK, 700, 'margin-bottom:2px;', '24px') + (sub ? p(sub, 12, MUTED, 400, 'margin-bottom:10px;', '24px') : '') + body +
    '</td></tr></tbody></table>';
}

function callout(title: string, body: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 12px;"><tr><td style="border-left:3px solid ${TEAL};padding:2px 0 2px 12px;">` +
    p(escapeHtml(title), 14, INK, 700, 'margin-bottom:2px;', '20px') + p(escapeHtml(body), 13, BODY, 400, '', '1.5') + '</td></tr></table>';
}

function smallTable(headers: string[], rows: string[][]): string {
  const th = headers.map((h, i) =>
    `<th style="${F}text-align:${i === 0 ? 'left' : 'right'};font-size:11px;font-weight:600;color:${MUTED};padding:0 0 6px ${i === 0 ? '0' : '12px'};border-bottom:1px solid ${LINE};text-transform:uppercase;letter-spacing:0.5px;">${h}</th>`).join('');
  const trs = rows.map(r => '<tr>' + r.map((c, i) =>
    `<td style="${F}font-size:13px;color:${INK};padding:8px 0 8px ${i === 0 ? '0' : '12px'};border-bottom:1px solid #EEF1F5;text-align:${i === 0 ? 'left' : 'right'};white-space:nowrap;">${c}</td>`).join('') + '</tr>').join('');
  return `<table style="width:100%;border-collapse:collapse;border-spacing:0;"><tr>${th}</tr>${trs}</table>`;
}

const spacer = '<div style="height:10px;"></div>';

function groupTable(rows: DigestGroupRow[], head: string, hideSentimentChange: boolean): string {
  const withSentimentChange = !hideSentimentChange && rows.some(r => r.sentimentDelta !== null);
  if (withSentimentChange) {
    return smallTable([head, 'Positive', 'Change', 'Named in'],
      rows.map(r => [escapeHtml(r.name), pctText(r.positivePct), chg(r.sentimentDelta), pctText(r.namedPct)]));
  }
  return smallTable([head, 'Positive', 'Named in', 'Change'],
    rows.map(r => [escapeHtml(r.name), pctText(r.positivePct), pctText(r.namedPct), chg(r.visibilityDelta)]));
}

export function digestSubject(payload: DigestPayload): string {
  return `Your PerceptionX ${payload.period.short} Update`;
}

export function renderDigestHtml(payload: DigestPayload, opts: DigestRenderOptions): string {
  const token = opts.logoDevToken;
  const appUrl = opts.appUrl.replace(/\/+$/, '');
  const prev = payload.period.previousLabel;
  const m = payload.metrics;
  const hiddenSent = payload.sentimentChangeHidden ? 'classifier updated' : null;
  const hiddenEps = payload.sentimentChangeHidden ? 'comparison resumes next quarter' : null;
  const brandDomain = payload.brand.domain || `${payload.brand.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  const n = payload.narrative;

  const header = `<table style="width:100%;border-collapse:collapse;border-spacing:0;"><tr>` +
    `<td class="em-stack" style="vertical-align:top;"><img alt="PerceptionX" height="32" src="${appUrl}/logos/PerceptionX-PrimaryLogo.png" style="display:block;border:0;height:32px;width:auto;"></td>` +
    `<td class="em-stack em-header-meta" style="vertical-align:top;text-align:right;">${p('QUARTERLY UPDATE', 11, PINK, 700, 'letter-spacing:0.6px;', '14px')}${p(escapeHtml(payload.period.quarter), 13, MUTED, 500, 'margin-top:2px;', '16px')}</td></tr></table>`;

  const since = prev ? `, and what changed since ${escapeHtml(prev)}` : '';
  const intro = `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0 8px 0;"><tbody><tr><td>` +
    `<h1 style="color:${INK};${F}font-size:26px;font-weight:700;letter-spacing:-0.4px;margin:0 0 10px 0;padding:0;">${escapeHtml(digestSubject(payload))}</h1>` +
    p(`Hi ${escapeHtml(payload.recipient.firstName)},`, 15, MUTED, 400, '', '1.55') +
    p(`Here's how AI assistants described <strong>${escapeHtml(payload.brand.name)}</strong> to candidates ${payload.scope.preposition} <strong>${escapeHtml(payload.scope.locationLabel)}</strong> this quarter${since}.`, 15, MUTED, 400, '', '1.55') +
    '</td></tr></tbody></table>';

  const scopeSub = [payload.scope.locationLabel]
    .concat(payload.scope.markets.length > 1 ? [payload.scope.markets.join(', ')] : [])
    .concat(payload.scope.jobFunctions.length ? [payload.scope.jobFunctions.length > 3 ? `${payload.scope.jobFunctions.length} job functions` : payload.scope.jobFunctions.join(', ')] : [])
    .map(escapeHtml).join(DOT);
  const metric = (label: string, x: DigestMetric, suffix: string, hidden: string | null, grade?: string) =>
    metricCard(label, x.value === null ? '–' : `${x.value}${suffix}`, pill(x.delta, prev, hidden), grade);
  const scopeCard = `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="em-project-card" style="margin:16px 0;background-color:#F8FAFC;border-radius:12px;border:1px solid ${LINE};"><tbody><tr><td style="padding:20px;">` +
    `<table style="width:100%;border-collapse:collapse;border-spacing:0;"><tr>` +
    `<td style="width:28px;vertical-align:middle;padding-right:12px;">${mark(brandDomain, token, 28)}</td>` +
    `<td style="width:100%;vertical-align:middle;">${p(escapeHtml(payload.brand.name), 17, INK, 700, '', '1.2')}${p(scopeSub, 13, MUTED, 400, 'margin-top:2px;', '20px')}</td></tr></table>` +
    p(escapeHtml(payload.comparisonNote), 12, MUTED, 400, 'margin:14px 0 16px 0;', '1.4') +
    `<table style="width:100%;border-collapse:separate;border-spacing:0;">` +
    metricRow(metric('Employer Perception Score', m.eps, '', hiddenEps, m.eps.grade), metric('Sentiment', m.sentiment, '%', hiddenSent)) +
    `<tr class="em-metric-spacer"><td colspan="2" style="height:10px;font-size:0;line-height:0;"></td></tr>` +
    metricRow(metric('Visibility', m.visibility, '%', null), metric('Relevance', m.relevance, '', null)) +
    '</table></td></tr></tbody></table>';

  const changed = n && n.callouts.length
    ? section('What changed', 'The moves that matter this quarter.', n.callouts.map(c => callout(c.title, c.body)).join(''))
    : '';

  const groupSub = (what: string) => payload.sentimentChangeHidden || !prev
    ? `Positive sentiment and how often AI names ${escapeHtml(payload.brand.name)}${prev ? `. Visibility change since ${escapeHtml(prev)}.` : '.'}`
    : `Positive sentiment, change since ${escapeHtml(prev)}, and how often AI names ${escapeHtml(payload.brand.name)}${what}.`;
  const markets = payload.byMarket.length > 1
    ? section('By market', groupSub(''), groupTable(payload.byMarket, 'Market', payload.sentimentChangeHidden) + (n?.marketsNote ? spacer + p(escapeHtml(n.marketsNote), 13, BODY) : ''))
    : '';
  const functions = payload.byFunction.length > 1
    ? section('By job function', groupSub(''), groupTable(payload.byFunction, 'Function', payload.sentimentChangeHidden) + (n?.functionsNote ? spacer + p(escapeHtml(n.functionsNote), 13, BODY) : ''))
    : '';

  const act = n?.action
    ? `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:20px;"><tbody><tr><td style="background:#FFF5F8;border:1px solid ${PINK};border-radius:10px;padding:16px;">` +
      p('Where to act next', 14, INK, 700, 'margin-bottom:4px;', '24px') + p(escapeHtml(n.action), 13, BODY) + '</td></tr></tbody></table>'
    : '';

  const sinceSub = prev ? `, with the change since ${escapeHtml(prev)}` : '';
  const peers = payload.employers.length
    ? section('Employers AI names alongside you', `Share of all answers that mention each employer${sinceSub}.`, barList(payload.employers.map(r => barRow(r, token))))
    : '';
  const sources = payload.sources.length
    ? section('Sources AI reads', `Share of answers citing each source${sinceSub}.${payload.sources.some(s => s.owned) ? ' Owned sites in navy.' : ''}`, barList(payload.sources.map(r => barRow(r, token))))
    : '';

  const themeSub = `What AI talks about when it describes working at ${escapeHtml(payload.brand.name)}, and how positively.${payload.sentimentChangeHidden ? ' Change resumes next quarter.' : ''}`;
  const themeRows = payload.attributes.map(a => {
    const base = [attributeLabel(a, appUrl), `${a.raisedPct}%`, pctText(a.positivePct)];
    return payload.sentimentChangeHidden || !prev ? base : base.concat(chg(a.delta));
  });
  const themes = payload.attributes.length
    ? section('Themes', themeSub, smallTable(payload.sentimentChangeHidden || !prev ? ['Attribute', 'Raised in', 'Positive'] : ['Attribute', 'Raised in', 'Positive', 'Change'], themeRows))
    : '';

  const button = `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="text-align:center;margin:24px 0 0 0;"><tbody><tr><td>` +
    `<a href="${escapeHtml(payload.chatUrl)}" style="color:#ffffff;text-decoration:none;background-color:${NAVY};${F}font-size:13px;font-weight:600;padding:11px 20px;border-radius:8px;display:inline-block;" target="_blank">Open your update in PerceptionX →</a>` +
    p(escapeHtml(payload.chatNote), 12, MUTED, 400, 'margin-top:10px;') + '</td></tr></tbody></table>';

  const year = new Date().getUTCFullYear();
  const footer = `<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:32px;"><tbody><tr><td>` +
    `<hr style="width:100%;border:none;border-top:1px solid #eaeaea;margin:0 0 16px 0;">` +
    p(`<a href="${appUrl}/account" style="color:#6b7280;text-decoration:underline;">Manage email preferences</a>`, 12, '#6b7280', 400, 'text-align:center;margin-bottom:12px;', '24px') +
    p(`<a href="https://perceptionx.ai" style="color:#9ca3af;text-decoration:underline;">perceptionx.ai</a><br><span style="font-size:11px;">© ${year} PerceptionX FZ-LLC</span>`, 12, '#9ca3af', 400, 'text-align:center;', '20px') +
    '</td></tr></tbody></table>';

  const preheader = n?.preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(n.preheader)}</div>`
    : '';

  return '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
    '<html dir="ltr" lang="en"><head><meta content="width=device-width, initial-scale=1" name="viewport"><meta content="text/html; charset=UTF-8" http-equiv="Content-Type"><meta name="x-apple-disable-message-reformatting">' +
    `<title>${escapeHtml(digestSubject(payload))}</title>` +
    '<style>@media only screen and (max-width: 600px) { .em-container > tbody > tr > td { padding: 24px !important; } .em-project-card > tbody > tr > td { padding: 14px !important; } .em-stack { display: block !important; box-sizing: border-box !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; } .em-header-meta { text-align: left !important; margin-top: 12px !important; } .em-metric-card { height: auto !important; margin-bottom: 10px !important; } .em-metric-spacer { display: none !important; } }</style>' +
    '</head><body dir="ltr" lang="en" style="background-color:#F4F5F7;padding:0;margin:0;">' + preheader +
    '<table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center"><tbody><tr><td style="background-color:#F4F5F7;padding:24px 0;">' +
    `<table align="center" width="100%" class="em-container" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border:1px solid ${LINE};border-radius:16px;margin:0 auto;"><tbody><tr style="width:100%"><td style="padding:32px;">` +
    header + intro + scopeCard + changed + markets + functions + act + peers + sources + themes + button + footer +
    '</td></tr></tbody></table></td></tr></tbody></table></body></html>';
}
