require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const libre = require('libreoffice-convert');
const libreConvert = require('util').promisify(libre.convert);
const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType,
  VerticalAlign, ImageRun, Footer, TabStopType
} = require('docx');

const cors = require('cors');
const app = express();
app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:3001', 'https://app.perceptionx.ai'],
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-api-key'] !== (process.env.REPORT_API_KEY || process.env.API_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Supabase client ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY // service role key — server only
);

// ── Anthropic client ─────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Design tokens ────────────────────────────────────────────────────
const NIGHTSKY  = "13274F";
const DUSK_NAVY = "183056";
const PINK      = "DB5E89";
const SILVER    = "EBECED";
const WHITE     = "FFFFFF";
const BODY_GRAY = "4A5568";
const GREEN     = "059669";
const AMBER     = "D97706";
const HF = "Plus Jakarta Sans";
const BF = "Plus Jakarta Sans";

// ── Logo assets (loaded once at startup) ────────────────────────────
const logoBytes     = fs.readFileSync(path.join(__dirname, 'assets/px_logo_transparent.png'));
const logoDarkBytes = fs.readFileSync(path.join(__dirname, 'assets/px_logo_for_dark.png'));

// ── Helpers ──────────────────────────────────────────────────────────
const NB = { style: BorderStyle.NONE, size: 0, color: WHITE };
const allNone = { top: NB, bottom: NB, left: NB, right: NB };
function btmOnly(c) { c = c || "D1D5DB"; return { top: NB, bottom: { style: BorderStyle.SINGLE, size: 1, color: c }, left: NB, right: NB }; }
function t(text, opts) { opts = opts || {}; return new TextRun({ text, font: BF, size: opts.size || 18, bold: opts.bold || false, italics: opts.italic || false, color: opts.color || BODY_GRAY }); }
function bodyPara(children, before, after) { return new Paragraph({ spacing: { before: before || 40, after: after || 40 }, children }); }
function sectionLabel(text) { return new Paragraph({ spacing: { before: 200, after: 40 }, children: [new TextRun({ text: text.toUpperCase(), font: HF, size: 15, bold: true, color: PINK, characterSpacing: 30 })] }); }
function pinkRule() { return new Paragraph({ spacing: { before: 0, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PINK } }, children: [] }); }
function bullet(text) {
  return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { before: 28, after: 28 },
    children: [new TextRun({ text, font: BF, size: 17, color: BODY_GRAY })] });
}
function tblHeaderRow(labels, widths) {
  return new TableRow({ children: labels.map((text, i) => new TableCell({
    borders: allNone, shading: { fill: NIGHTSKY, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    width: { size: widths[i], type: WidthType.DXA },
    children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text, font: HF, size: 16, bold: true, color: WHITE })] })]
  }))});
}
function dataRow(label, p1, p2, note, isNew) {
  let p2Color = BODY_GRAY;
  if (p2 && p2[0] === '+') p2Color = GREEN;
  if (p2 && (p2[0] === '−' || p2[0] === '-')) p2Color = "DC2626";
  if (p2 === 'Stable') p2Color = BODY_GRAY;
  const cell = (text, align, color, bold) => new TableCell({
    borders: btmOnly(), shading: { fill: WHITE, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    children: [new Paragraph({ alignment: align || AlignmentType.LEFT, children: [new TextRun({ text: text || '—', font: BF, size: 17, color: color || BODY_GRAY, bold: bold || false })] })]
  });
  return new TableRow({ children: [
    cell(label, AlignmentType.LEFT, NIGHTSKY, true),
    cell(p1 || '—', AlignmentType.CENTER, BODY_GRAY, false),
    cell(p2, AlignmentType.CENTER, p2Color, true),
  ]});
}
function subheaderRow(text, bg) {
  return new TableRow({ children: [new TableCell({ columnSpan: 3, borders: allNone,
    shading: { fill: bg || "EEF2FF", type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 160, right: 160 },
    children: [new Paragraph({ children: [new TextRun({ text, font: BF, size: 15, bold: true, color: NIGHTSKY })] })]
  })]});
}

// ── Data helpers ─────────────────────────────────────────────────────
function normCompetitor(name) {
  name = (name || '').trim();
  const map = {
    'Google Poland':'Google','Google Polska':'Google','Alphabet':'Google',
    'Meta (Facebook)':'Meta','Facebook':'Meta','Instagram':'Meta',
    'Amazon Prime Video':'Amazon','Prime Video':'Amazon',
    'HBO Max':'HBO/Max','Max':'HBO/Max','Warner Bros. Discovery':'HBO/Max',
    'Apple TV+':'Apple TV+','Apple':'Apple TV+',
    'Mercado Libre':'Mercado Livre',
  };
  return map[name] || name;
}

function normSource(cite) {
  const url = cite.url || '';
  const src = (cite.source || '').trim().toLowerCase();
  const domMatch = url.match(/https?:\/\/(?:www\.|m\.)?([^/#?]+)/);
  const domain = domMatch ? domMatch[1] : '';
  const map = {
    'glassdoor.com':'Glassdoor','glassdoor.co.uk':'Glassdoor','glassdoor.ie':'Glassdoor',
    'glassdoor.com.ar':'Glassdoor','glassdoor.nl':'Glassdoor','glassdoor.de':'Glassdoor',
    'indeed.com':'Indeed','uk.indeed.com':'Indeed','ie.indeed.com':'Indeed','nl.indeed.com':'Indeed',
    'linkedin.com':'LinkedIn','reddit.com':'Reddit','teamblind.com':'Blind',
    'comparably.com':'Comparably','levels.fyi':'Levels.fyi','youtube.com':'YouTube',
    'greatplacetowork.com':'Great Place to Work','greatplacetowork.pl':'Great Place to Work',
  };
  return map[src] || map[domain] || src || domain;
}

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
function fmtPct(p) { return p === null || p === undefined ? '—' : `${p}%`; }
function delta(p2, p1) {
  if (p2 === null || p2 === undefined || p1 === null || p1 === undefined) return '—';
  const d = p2 - p1;
  if (Math.abs(d) <= 1) return 'Stable';
  return (d > 0 ? '+' : '−') + Math.abs(d) + '%';
}

// ── Main data computation ─────────────────────────────────────────────
function computeMetrics(rows) {
  const p1rows = rows.filter(r => r.period === 1);
  const p2rows = rows.filter(r => r.period === 2);

  function metrics(records) {
    const total = records.length;
    const mentioned = records.filter(r => r.company_mentioned).length;
    const discAll = records.filter(r => r.prompt_type === 'discovery');
    const discMentioned = discAll.filter(r => r.company_mentioned).length;
    const withCitations = records.filter(r => r.citations && r.citations.length > 0).length;

    // Competitors
    const compCounts = {};
    discAll.forEach(r => {
      if (!r.detected_competitors) return;
      const seen = new Set();
      r.detected_competitors.split(',').forEach(c => {
        const n = normCompetitor(c.trim());
        if (n && !seen.has(n)) { seen.add(n); compCounts[n] = (compCounts[n] || 0) + 1; }
      });
    });

    // Sources
    const srcCounts = {};
    records.forEach(r => {
      if (!r.citations) return;
      const seen = new Set();
      r.citations.forEach(cite => {
        const s = normSource(cite);
        if (s && !seen.has(s)) { seen.add(s); srcCounts[s] = (srcCounts[s] || 0) + 1; }
      });
    });

    return {
      total, mentioned, visibilityPct: pct(mentioned, total),
      sentimentPct: null, // set from company_sentiment_scores_mv in endpoint
      relevancePct: pct(withCitations, total),
      compCounts, compTotal: discAll.length,
      srcCounts, srcTotal: total,
    };
  }

  return { p1: metrics(p1rows), p2: metrics(p2rows) };
}

// ── Claude AI exec summary + perception themes ────────────────────────
async function callClaude({ companyName, market, p1Label, p2Label, p1, p2, topComps, topSrcs, newEntrants }) {
  const compLines = topComps.map(c => {
    const pp1 = pct(p1.compCounts[c] || 0, p1.compTotal);
    const pp2 = pct(p2.compCounts[c] || 0, p2.compTotal);
    return `  - ${c}: ${pp1}% (${p1Label}) → ${pp2}% (${p2Label}), change: ${delta(pp2, pp1)}`;
  }).join('\n');
  const srcLines = topSrcs.map(({ s, pp1, pp2 }) =>
    `  - ${s}: ${pp1}% (${p1Label}) → ${pp2}% (${p2Label}), change: ${delta(pp2, pp1)}`
  ).join('\n');
  const newEntrantLines = newEntrants.length
    ? newEntrants.map(c => `  - ${c}: ${pct(p2.compCounts[c] || 0, p2.compTotal)}%`).join('\n')
    : '  None';

  const prompt = `You are PerceptionX, an AI employer perception intelligence company. You are writing a monthly AI employer perception report for ${companyName} in ${market}.

DATA:
Visibility score (% of all AI responses that mention ${companyName}):
  ${p1Label}: ${p1.visibilityPct}%
  ${p2Label}: ${p2.visibilityPct}%
  Change: ${delta(p2.visibilityPct, p1.visibilityPct)}

Sentiment (% of "who are the best employers" type prompts that include ${companyName}):
  ${p1Label}: ${fmtPct(p1.sentimentPct)}
  ${p2Label}: ${fmtPct(p2.sentimentPct)}
  Change: ${delta(p2.sentimentPct, p1.sentimentPct)}

Relevance (% of responses that cite a source when mentioning ${companyName}):
  ${p1Label}: ${p1.relevancePct}%
  ${p2Label}: ${p2.relevancePct}%
  Change: ${delta(p2.relevancePct, p1.relevancePct)}

Top competitors co-mentioned in discovery responses:
${compLines}

New entrants to competitive set this period:
${newEntrantLines}

Top sources cited when ${companyName} is mentioned:
${srcLines}

TASK:
Return a JSON object with exactly these keys. No markdown, no code fences, just raw JSON.

{
  "whatChanged": "One paragraph (~80 words). What materially shifted between ${p1Label} and ${p2Label}. Use specific numbers. Direct, confident tone — no hedging.",
  "whatDidnt": "One paragraph (~60 words). What stayed consistent. Reference specific metrics or sources that held steady. Direct tone.",
  "soWhat": "One paragraph (~60 words). What this means for ${companyName}'s employer brand strategy. Be specific to this company and market. No generic advice.",
  "competitiveAnalysis": "2-3 sentences. What is the most important thing the competitive data shows? Who is growing, who is declining, what does the competitive frame tell us about how AI positions ${companyName} in ${market}? Specific numbers, no generic language.",
  "sourceAnalysis": "2-3 sentences. What is the most important source shift? What does the source mix tell us about where the AI narrative is coming from and what that means for the brand? Specific, actionable.",
  "strengths": ["Specific strength derived from the data", "...", "...", "...", "..."],
  "risks": ["Specific risk or gap derived from the data", "...", "...", "...", "..."]
}

Rules:
- strengths and risks must each have 4-5 items
- Each strength/risk must be specific to ${companyName} in ${market} — no generic statements
- Reference actual numbers, sources, or competitor names where relevant
- Tone: sharp, direct, like a senior analyst briefing a CHRO`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  // Strip any accidental markdown fences
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(jsonStr);
}

// ── Perception Themes table ───────────────────────────────────────────
function themesTable(strengths, risks) {
  const GREEN_BG  = "F0FDF4";
  const AMBER_BG  = "FFFBEB";
  const GREEN_HDR = "059669";
  const AMBER_HDR = "D97706";
  const maxRows = Math.max(strengths.length, risks.length);

  const headerRow = new TableRow({ children: [
    new TableCell({
      borders: allNone,
      shading: { fill: GREEN_HDR, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      width: { size: 5160, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: "✓  Strengths", font: HF, size: 16, bold: true, color: WHITE })] })],
    }),
    new TableCell({
      borders: allNone,
      shading: { fill: AMBER_HDR, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      width: { size: 5160, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: "⚠  Risks & Gaps", font: HF, size: 16, bold: true, color: WHITE })] })],
    }),
  ]});

  const dataRows = [];
  for (let i = 0; i < maxRows; i++) {
    dataRows.push(new TableRow({ children: [
      new TableCell({
        borders: btmOnly("BBF7D0"),
        shading: { fill: GREEN_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({ children: [
          new TextRun({ text: strengths[i] ? "✓  " : "", font: BF, size: 17, color: GREEN_HDR, bold: true }),
          new TextRun({ text: strengths[i] || "", font: BF, size: 17, color: BODY_GRAY }),
        ]})],
      }),
      new TableCell({
        borders: btmOnly("FDE68A"),
        shading: { fill: AMBER_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({ children: [
          new TextRun({ text: risks[i] ? "⚠  " : "", font: BF, size: 17, color: AMBER_HDR, bold: true }),
          new TextRun({ text: risks[i] || "", font: BF, size: 17, color: BODY_GRAY }),
        ]})],
      }),
    ]}));
  }

  return new Table({ width: { size: 10320, type: WidthType.DXA }, columnWidths: [5160, 5160], rows: [headerRow, ...dataRows] });
}

// ── Report generation ─────────────────────────────────────────────────
async function generateReport({ companyName, market, p1Label, p2Label, metrics }) {
  const { p1, p2 } = metrics;
  const now = new Date(); const monthYear = now.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Build competitor table rows
  const allComps = new Set([...Object.keys(p1.compCounts), ...Object.keys(p2.compCounts)]);
  const p1Sig = new Set(Object.keys(p1.compCounts).filter(k => pct(p1.compCounts[k], p1.compTotal) >= 5));
  const p2Sig = new Set(Object.keys(p2.compCounts).filter(k => pct(p2.compCounts[k], p2.compTotal) >= 5));
  const newEntrants = [...p2Sig].filter(k => !p1Sig.has(k));
  const established = [...p2Sig].filter(k => p1Sig.has(k));

  const compRows = [
    tblHeaderRow(["Competitor", p1Label, p2Label], [5200, 2560, 2560]),
    subheaderRow("Established competitors", "EEF2FF"),
    ...established
      .sort((a, b) => pct(p2.compCounts[b] || 0, p2.compTotal) - pct(p2.compCounts[a] || 0, p2.compTotal))
      .map(c => {
        const pp1 = pct(p1.compCounts[c] || 0, p1.compTotal);
        const pp2 = pct(p2.compCounts[c] || 0, p2.compTotal);
        return dataRow(c, fmtPct(pp1), fmtPct(pp2), delta(pp2, pp1));
      }),
    subheaderRow("New entrants", "FFF0F6"),
    ...newEntrants
      .sort((a, b) => pct(p2.compCounts[b] || 0, p2.compTotal) - pct(p2.compCounts[a] || 0, p2.compTotal))
      .map(c => {
        const pp2 = pct(p2.compCounts[c] || 0, p2.compTotal);
        return dataRow(c, '—', fmtPct(pp2), 'New this period', true);
      }),
  ];

  // Build source table rows — min 3% in either period, sort by p2 desc, cap at 12
  const allSrcs = new Set([...Object.keys(p1.srcCounts), ...Object.keys(p2.srcCounts)]);
  const filteredSrcs = [...allSrcs]
    .map(s => ({ s, pp1: pct(p1.srcCounts[s] || 0, p1.srcTotal), pp2: pct(p2.srcCounts[s] || 0, p2.srcTotal) }))
    .filter(({ pp1, pp2 }) => pp1 >= 3 || pp2 >= 3)
    .sort((a, b) => b.pp2 - a.pp2)
    .slice(0, 12);
  const srcRows = [
    tblHeaderRow(["Source", p1Label, p2Label], [5200, 2560, 2560]),
    ...filteredSrcs.map(({ s, pp1, pp2 }) => dataRow(s, fmtPct(pp1), fmtPct(pp2), delta(pp2, pp1))),
  ];

  // Call Claude for exec summary + perception themes
  const topComps = [...established, ...newEntrants].slice(0, 8);
  let aiCopy;
  try {
    aiCopy = await callClaude({ companyName, market, p1Label, p2Label, p1, p2, topComps, topSrcs: filteredSrcs, newEntrants });
  } catch (err) {
    console.error('Claude call failed, using fallback copy:', err.message);
    const visDelta = p2.visibilityPct - p1.visibilityPct;
    aiCopy = {
      whatChanged: `Overall visibility ${visDelta >= 0 ? 'held steady' : 'dipped'} from ${p1.visibilityPct}% to ${p2.visibilityPct}% across ${p2.total.toLocaleString()} responses. Sentiment moved from ${fmtPct(p1.sentimentPct)} to ${fmtPct(p2.sentimentPct)}, and relevance from ${p1.relevancePct}% to ${p2.relevancePct}%.`,
      whatDidnt: `Core brand positioning remained consistent. ${companyName} continues to appear across major AI platforms with stable citation patterns.`,
      soWhat: `Shifts in the competitive set and source landscape point to specific, addressable levers for improving AI employer perception.`,
      competitiveAnalysis: `The competitive data reflects how AI platforms are framing ${companyName} relative to peers in ${market}. Review the table above for period-over-period shifts.`,
      sourceAnalysis: `The source mix indicates where the AI narrative is anchored for ${companyName} in ${market}. Shifts in source weight signal changes in what content AI platforms are drawing from.`,
      strengths: ['Consistent visibility across AI platforms', 'Strong source citation rate', 'Established presence in discovery responses'],
      risks: ['Competitive pressure from new entrants', 'Source concentration risk', 'Discovery gap vs. top competitors'],
    };
  }
  const { whatChanged, whatDidnt, soWhat, competitiveAnalysis, sourceAnalysis, strengths, risks } = aiCopy;

  const doc = new Document({
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 200 } }, run: { font: BF, color: PINK, bold: true } } }] }] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 960, bottom: 900, left: 960 } } },
      footers: { default: new Footer({ children: [new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: SILVER } },
        spacing: { before: 140 },
        tabStops: [{ type: TabStopType.RIGHT, position: 10320 }],
        children: [
          new ImageRun({ data: logoBytes, transformation: { width: 72, height: 12 }, type: "png" }),
          new TextRun({ text: "\t", font: BF }),
          new TextRun({ text: `Confidential  ·  perceptionx.ai  ·  ${monthYear}`, font: BF, size: 14, color: "9CA3AF" }),
        ]
      })] }) },
      children: [

        // HEADER
        new Table({ width: { size: 10320, type: WidthType.DXA }, columnWidths: [7000, 3320], rows: [new TableRow({ children: [
          new TableCell({ borders: allNone, shading: { fill: NIGHTSKY, type: ShadingType.CLEAR }, margins: { top: 300, bottom: 300, left: 440, right: 440 }, children: [
            new Paragraph({ spacing: { before: 0, after: 40 }, children: [new TextRun({ text: "AI EMPLOYER PERCEPTION BRIEF", font: HF, size: 15, bold: true, color: PINK, characterSpacing: 30 })] }),
            new Paragraph({ spacing: { before: 0, after: 20 }, children: [new TextRun({ text: `${companyName} · ${market}`, font: HF, size: 36, bold: true, color: WHITE })] }),
            new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: `${p1Label}  →  ${p2Label}`, font: BF, size: 17, color: "B0C4DE" })] }),
          ]}),
          new TableCell({ borders: allNone, shading: { fill: DUSK_NAVY, type: ShadingType.CLEAR }, margins: { top: 300, bottom: 300, left: 440, right: 440 }, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ data: logoDarkBytes, transformation: { width: 110, height: 19 }, type: "png" })] })] }),
        ]})] }),

        new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),

        // EXEC SUMMARY
        sectionLabel("Executive Summary"),
        pinkRule(),
        bodyPara([t("What changed: ", { bold: true, color: NIGHTSKY }), t(whatChanged)], 140, 40),
        bodyPara([t("What didn't change: ", { bold: true, color: NIGHTSKY }), t(whatDidnt)], 0, 40),
        bodyPara([t("So what: ", { bold: true, color: NIGHTSKY }), t(soWhat)], 0, 0),

        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),

        // VISIBILITY
        sectionLabel("Scores"),
        pinkRule(),
        new Table({ width: { size: 10320, type: WidthType.DXA }, columnWidths: [5200, 2560, 2560], rows: [
          tblHeaderRow(["Metric", p1Label, p2Label], [5200, 2560, 2560]),
          dataRow("Visibility", fmtPct(p1.visibilityPct), fmtPct(p2.visibilityPct), delta(p2.visibilityPct, p1.visibilityPct)),
          dataRow("Sentiment",          fmtPct(p1.sentimentPct),  fmtPct(p2.sentimentPct),  delta(p2.sentimentPct, p1.sentimentPct)),
          dataRow("Relevance",          fmtPct(p1.relevancePct),  fmtPct(p2.relevancePct),  delta(p2.relevancePct, p1.relevancePct)),
        ]}),

        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),

        // COMPETITORS
        sectionLabel("Competitive Landscape"),
        pinkRule(),
        bodyPara([t(`% of discovery responses where each competitor was co-mentioned. New entrants flagged.`, { italic: true, size: 17 })], 60, 60),
        new Table({ width: { size: 10320, type: WidthType.DXA }, columnWidths: [5200, 2560, 2560], rows: compRows }),
        bodyPara([t(competitiveAnalysis)], 100, 0),

        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),

        // SOURCES
        sectionLabel("Source Footprint"),
        pinkRule(),
        bodyPara([t(`% of responses where each source was cited.`, { italic: true, size: 17 })], 60, 60),
        new Table({ width: { size: 10320, type: WidthType.DXA }, columnWidths: [5200, 2560, 2560], rows: srcRows }),
        bodyPara([t(sourceAnalysis)], 100, 0),

        new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),

        // PERCEPTION THEMES
        sectionLabel("Perception Themes"),
        pinkRule(),
        bodyPara([t(`AI-derived strengths and risks for ${companyName} in ${market}, based on this period's data.`, { italic: true, size: 17 })], 60, 60),
        themesTable(strengths, risks),

      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

// ── Endpoint ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/generate-report', async (req, res) => {
  const { company_id, company_name, market, p1_start, p1_end, p2_start, p2_end } = req.body;

  // Validate
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(company_id)) return res.status(400).json({ error: 'Invalid company_id' });
  if (!company_name || !market)  return res.status(400).json({ error: 'Missing company_name or market' });

  try {
    // Fetch all rows for both periods + sentiment from materialized view
    const p1Month = p1_start.slice(0, 7); // "YYYY-MM"
    const p2Month = p2_start.slice(0, 7);

    const [reportData, sentimentData, relevanceData] = await Promise.all([
      supabase.rpc('get_report_data', {
        p_company_id: company_id,
        p_p1_start: p1_start,
        p_p1_end:   p1_end,
        p_p2_start: p2_start,
        p_p2_end:   p2_end,
      }),
      supabase
        .from('company_sentiment_scores_mv')
        .select('response_month, positive_themes, total_themes')
        .eq('company_id', company_id)
        .gte('response_month', p1_start)
        .lte('response_month', p2_end),
      supabase
        .from('company_relevance_scores_mv')
        .select('response_month, relevance_score, valid_citations')
        .eq('company_id', company_id)
        .gte('response_month', p1_start)
        .lte('response_month', p2_end),
    ]);

    if (reportData.error) throw reportData.error;

    // Compute metric % per period from materialized views
    function sentimentPctForMonth(month, rows) {
      if (!rows || !rows.length) return null;
      const matching = rows.filter(r => r.response_month && r.response_month.slice(0, 7) === month);
      const pos = matching.reduce((s, r) => s + (r.positive_themes || 0), 0);
      const tot = matching.reduce((s, r) => s + (r.total_themes || 0), 0);
      return tot > 0 ? Math.round(pos / tot * 100) : null;
    }

    function relevancePctForMonth(month, rows) {
      if (!rows || !rows.length) return null;
      const matching = rows.filter(r => r.response_month && r.response_month.slice(0, 7) === month);
      // Weighted average of relevance_score by valid_citations
      const totalWeight = matching.reduce((s, r) => s + (r.valid_citations || 0), 0);
      if (totalWeight === 0) return null;
      const weightedSum = matching.reduce((s, r) => s + (parseFloat(r.relevance_score) || 0) * (r.valid_citations || 0), 0);
      return Math.round(weightedSum / totalWeight);
    }

    const sentRows = sentimentData.data || [];
    const relRows = relevanceData.data || [];
    const p1SentimentPct = sentimentPctForMonth(p1Month, sentRows);
    const p2SentimentPct = sentimentPctForMonth(p2Month, sentRows);
    const p1RelevancePct = relevancePctForMonth(p1Month, relRows);
    const p2RelevancePct = relevancePctForMonth(p2Month, relRows);

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function labelFromDateStr(d) { const [y, m] = d.split('-'); return `${MONTHS[parseInt(m,10)-1]} ${y}`; }
    const p1Label = labelFromDateStr(p1_start);
    const p2Label = labelFromDateStr(p2_start);

    const metrics = computeMetrics(reportData.data);
    // Always override from MVs (null means no data — displays as '—')
    metrics.p1.sentimentPct = p1SentimentPct;
    metrics.p2.sentimentPct = p2SentimentPct;
    if (p1RelevancePct !== null) metrics.p1.relevancePct = p1RelevancePct;
    if (p2RelevancePct !== null) metrics.p2.relevancePct = p2RelevancePct;

    const docxBuf = await generateReport({ companyName: company_name, market, p1Label, p2Label, metrics });

    const pdfBuf = await libreConvert(docxBuf, '.pdf', undefined);
    const slug = `${company_name}_${market}_AI_Brief.pdf`.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}"`);
    res.end(pdfBuf);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Report server running on ${PORT}`));
