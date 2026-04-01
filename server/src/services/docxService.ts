import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  HeadingLevel,
  TableLayoutType,
  VerticalAlign,
  Packer,
} from 'docx';
import { ReportData, CompetitorMetric } from '../types';

// Design tokens
const NAVY = '13274F';
const NAVY_SECONDARY = '183056';
const PINK = 'DB5E89';
const BODY_TEXT = '4A5568';
const GREEN = '059669';
const AMBER = 'D97706';
const RED = 'DC2626';
const WHITE = 'FFFFFF';
const SILVER = 'C0C0C0';
const LIGHT_GRAY = 'F7FAFC';

const FONT = 'Poppins';

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function delta(p1: number, p2: number): { text: string; color: string } {
  const diff = p2 - p1;
  if (Math.abs(diff) < 0.5) return { text: '—', color: BODY_TEXT };
  const sign = diff > 0 ? '+' : '';
  return {
    text: `${sign}${diff.toFixed(1)}pp`,
    color: diff > 0 ? GREEN : RED,
  };
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 400, after: 200 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 28,
        bold: true,
        color: NAVY,
      }),
    ],
  });
}

function bodyParagraph(label: string, content: string): Paragraph {
  return new Paragraph({
    spacing: { after: 150 },
    children: [
      new TextRun({ text: label, font: FONT, size: 20, bold: true, color: NAVY }),
      new TextRun({ text: ' ' + content, font: FONT, size: 20, color: BODY_TEXT }),
    ],
  });
}

function tableHeaderCell(text: string, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({ text, font: FONT, size: 18, bold: true, color: WHITE }),
        ],
      }),
    ],
  });
}

function tableDataCell(text: string, color?: string, bold?: boolean): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({
            text,
            font: FONT,
            size: 18,
            color: color || BODY_TEXT,
            bold: bold || false,
          }),
        ],
      }),
    ],
  });
}

function subheaderRow(text: string, colSpan: number): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: colSpan,
        shading: { type: ShadingType.SOLID, color: LIGHT_GRAY, fill: LIGHT_GRAY },
        children: [
          new Paragraph({
            spacing: { before: 40, after: 40 },
            children: [
              new TextRun({
                text,
                font: FONT,
                size: 18,
                bold: true,
                color: NAVY_SECONDARY,
                italics: true,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function generateDocx(data: ReportData): Promise<Buffer> {
  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 20, color: BODY_TEXT },
        },
      },
    },
    sections: [
      {
        headers: {
          default: new Header({
            children: [buildHeaderBand(data, monthYear)],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              // Silver rule
              new Paragraph({
                border: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: SILVER },
                },
                spacing: { before: 100 },
                children: [],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Confidential \u00B7 perceptionx.ai \u00B7 ${monthYear}`,
                    font: FONT,
                    size: 16,
                    color: BODY_TEXT,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Spacer after header
          new Paragraph({ spacing: { before: 200 }, children: [] }),

          // Executive Summary
          ...buildExecutiveSummary(data),

          // Visibility by Market
          ...buildVisibilitySection(data),

          // Competitive Landscape
          ...buildCompetitiveSection(data),

          // Source Footprint
          ...buildSourceSection(data),

          // Perception Themes
          ...buildThemesSection(data),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

function buildHeaderBand(data: ReportData, _monthYear: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({
        text: `${data.companyName}  |  ${data.market}  |  ${data.period1Label} vs ${data.period2Label}`,
        font: FONT,
        size: 22,
        bold: true,
        color: WHITE,
      }),
      new TextRun({ text: '          ', font: FONT, size: 22 }),
      new TextRun({
        text: 'PerceptionX',
        font: FONT,
        size: 22,
        bold: true,
        color: PINK,
      }),
    ],
  });
}

type DocChild = Paragraph | Table;

function buildExecutiveSummary(data: ReportData): DocChild[] {
  const p1 = data.period1;
  const p2 = data.period2;

  const visDelta = delta(p1.visibilityPct, p2.visibilityPct);
  const discDelta = delta(p1.discoveryPct, p2.discoveryPct);
  const relDelta = delta(p1.relevancePct, p2.relevancePct);

  // New entrants: competitors present in P2 but not P1
  const p1Names = new Set(p1.competitors.map((c) => c.name));
  const newEntrants = p2.competitors.filter((c) => !p1Names.has(c.name));
  const lostCompetitors = p1.competitors.filter(
    (c) => !p2.competitors.find((c2) => c2.name === c.name)
  );

  let whatChanged = `Visibility moved from ${pct(p1.visibilityPct)} to ${pct(p2.visibilityPct)} (${visDelta.text}). `;
  whatChanged += `Discovery rate shifted from ${pct(p1.discoveryPct)} to ${pct(p2.discoveryPct)} (${discDelta.text}). `;
  if (newEntrants.length > 0) {
    whatChanged += `New competitors appeared: ${newEntrants.map((c) => c.name).join(', ')}. `;
  }
  if (lostCompetitors.length > 0) {
    whatChanged += `Competitors no longer detected: ${lostCompetitors.map((c) => c.name).join(', ')}.`;
  }

  let whatDidnt = `Relevance remained ${Math.abs(p1.relevancePct - p2.relevancePct) < 2 ? 'stable' : 'in flux'} at ${pct(p2.relevancePct)} (${relDelta.text}). `;
  const stableCompetitors = p1.competitors.filter((c) =>
    p2.competitors.find((c2) => c2.name === c.name)
  );
  if (stableCompetitors.length > 0) {
    whatDidnt += `Core competitive set persists: ${stableCompetitors.slice(0, 5).map((c) => c.name).join(', ')}.`;
  }

  let soWhat = '';
  if (p2.visibilityPct > p1.visibilityPct) {
    soWhat += 'The brand is gaining traction in AI-generated responses. ';
  } else if (p2.visibilityPct < p1.visibilityPct) {
    soWhat += 'Visibility is declining \u2014 content and SEO strategy may need review. ';
  }
  if (newEntrants.length > 0) {
    soWhat += `${newEntrants.length} new entrant(s) suggest the competitive landscape is shifting. `;
  }
  soWhat += `Focus areas: ${p2.visibilityPct < 50 ? 'improving discoverability' : 'maintaining strong visibility'} and monitoring competitor movements.`;

  return [
    sectionHeading('Executive Summary'),
    bodyParagraph('What changed:', whatChanged),
    bodyParagraph("What didn't change:", whatDidnt),
    bodyParagraph('So what:', soWhat),
  ];
}

function buildVisibilitySection(data: ReportData): DocChild[] {
  const visDelta = delta(data.period1.visibilityPct, data.period2.visibilityPct);
  const discDelta = delta(data.period1.discoveryPct, data.period2.discoveryPct);
  const relDelta = delta(data.period1.relevancePct, data.period2.relevancePct);

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          tableHeaderCell('Metric', 30),
          tableHeaderCell(data.period1Label, 20),
          tableHeaderCell(data.period2Label, 20),
          tableHeaderCell('Note', 30),
        ],
      }),
      new TableRow({
        children: [
          tableDataCell('Visibility', BODY_TEXT, true),
          tableDataCell(pct(data.period1.visibilityPct)),
          tableDataCell(pct(data.period2.visibilityPct)),
          tableDataCell(visDelta.text, visDelta.color),
        ],
      }),
      new TableRow({
        children: [
          tableDataCell('Discovery', BODY_TEXT, true),
          tableDataCell(pct(data.period1.discoveryPct)),
          tableDataCell(pct(data.period2.discoveryPct)),
          tableDataCell(discDelta.text, discDelta.color),
        ],
      }),
      new TableRow({
        children: [
          tableDataCell('Relevance', BODY_TEXT, true),
          tableDataCell(pct(data.period1.relevancePct)),
          tableDataCell(pct(data.period2.relevancePct)),
          tableDataCell(relDelta.text, relDelta.color),
        ],
      }),
    ],
  });

  return [sectionHeading('Visibility by Market'), table];
}

function buildCompetitiveSection(data: ReportData): DocChild[] {
  const p1Map = new Map(data.period1.competitors.map((c) => [c.name, c]));
  const p2Map = new Map(data.period2.competitors.map((c) => [c.name, c]));
  const allNames = new Set([...p1Map.keys(), ...p2Map.keys()]);

  // Classify competitors
  const globalAnchors: CompetitorMetric[] = [];
  const regional: CompetitorMetric[] = [];
  const newEntrants: CompetitorMetric[] = [];

  allNames.forEach((name) => {
    const inP1 = p1Map.has(name);
    const inP2 = p2Map.has(name);
    const metric = p2Map.get(name) || p1Map.get(name)!;

    if (!inP1 && inP2) {
      newEntrants.push(metric);
    } else if (metric.count >= 5) {
      globalAnchors.push(metric);
    } else {
      regional.push(metric);
    }
  });

  const rows: TableRow[] = [
    new TableRow({
      children: [
        tableHeaderCell('Competitor', 30),
        tableHeaderCell(data.period1Label, 20),
        tableHeaderCell(data.period2Label, 20),
        tableHeaderCell('Note', 30),
      ],
    }),
  ];

  const addGroup = (label: string, items: CompetitorMetric[], isNewEntrant = false) => {
    if (items.length === 0) return;
    rows.push(subheaderRow(label, 4));
    items.forEach((c) => {
      const p1Val = p1Map.get(c.name);
      const p2Val = p2Map.get(c.name);
      const d = delta(p1Val?.pct || 0, p2Val?.pct || 0);
      rows.push(
        new TableRow({
          children: [
            tableDataCell(c.name, BODY_TEXT, true),
            tableDataCell(p1Val ? pct(p1Val.pct) : '—'),
            tableDataCell(p2Val ? pct(p2Val.pct) : '—'),
            tableDataCell(
              isNewEntrant ? 'New entrant' : d.text,
              isNewEntrant ? PINK : d.color
            ),
          ],
        })
      );
    });
  };

  addGroup('Global Anchors', globalAnchors);
  addGroup('Regional', regional);
  addGroup('New Entrants', newEntrants, true);

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows,
  });

  return [sectionHeading('Competitive Landscape'), table];
}

function buildSourceSection(data: ReportData): DocChild[] {
  const p1Map = new Map(data.period1.sources.map((s) => [s.domain, s]));
  const p2Map = new Map(data.period2.sources.map((s) => [s.domain, s]));
  const allDomains = new Set([...p1Map.keys(), ...p2Map.keys()]);

  const tableRows: TableRow[] = [
    new TableRow({
      children: [
        tableHeaderCell('Source', 30),
        tableHeaderCell(data.period1Label, 20),
        tableHeaderCell(data.period2Label, 20),
        tableHeaderCell('Note', 30),
      ],
    }),
  ];

  // Sort by P2 count descending, take top 15
  const sorted = Array.from(allDomains)
    .map((d) => ({ domain: d, p1: p1Map.get(d), p2: p2Map.get(d) }))
    .sort((a, b) => (b.p2?.count || 0) - (a.p2?.count || 0))
    .slice(0, 15);

  sorted.forEach(({ domain, p1, p2 }) => {
    const d = delta(p1?.pct || 0, p2?.pct || 0);
    const isNew = !p1 && p2;
    tableRows.push(
      new TableRow({
        children: [
          tableDataCell(domain, BODY_TEXT, true),
          tableDataCell(p1 ? pct(p1.pct) : '—'),
          tableDataCell(p2 ? pct(p2.pct) : '—'),
          tableDataCell(isNew ? 'New source' : d.text, isNew ? PINK : d.color),
        ],
      })
    );
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  return [sectionHeading('Source Footprint'), table];
}

function buildThemesSection(data: ReportData): DocChild[] {
  const p2Themes = data.period2.themes;
  const strengths = p2Themes.filter((t) => t.sentiment === 'positive');
  const risks = p2Themes.filter((t) => t.sentiment === 'negative' || t.sentiment === 'neutral');

  const elements: DocChild[] = [sectionHeading('Perception Themes')];

  // Two-column layout via a table
  const strengthBullets = strengths.length > 0
    ? strengths.map((t) => `\u2022 ${t.label} (${t.count} responses)`).join('\n')
    : '\u2022 No strong positive themes detected';

  const riskBullets = risks.length > 0
    ? risks.map((t) => `\u2022 ${t.label} (${t.count} responses)`).join('\n')
    : '\u2022 No significant risks detected';

  const themesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: GREEN, fill: GREEN },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: 'Strengths',
                    font: FONT,
                    size: 20,
                    bold: true,
                    color: WHITE,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: AMBER, fill: AMBER },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: 'Risks & Gaps',
                    font: FONT,
                    size: 20,
                    bold: true,
                    color: WHITE,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: strengthBullets.split('\n').map(
              (line) =>
                new Paragraph({
                  spacing: { before: 30, after: 30 },
                  children: [
                    new TextRun({ text: line, font: FONT, size: 18, color: BODY_TEXT }),
                  ],
                })
            ),
          }),
          new TableCell({
            children: riskBullets.split('\n').map(
              (line) =>
                new Paragraph({
                  spacing: { before: 30, after: 30 },
                  children: [
                    new TextRun({ text: line, font: FONT, size: 18, color: BODY_TEXT }),
                  ],
                })
            ),
          }),
        ],
      }),
    ],
  });

  elements.push(themesTable);
  return elements;
}
