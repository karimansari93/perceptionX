import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildProtectedStems,
  buildShortlister,
  type CanonicalRef,
  hasParentCanonical,
  isProtected,
  normalize,
  rollUpToParent,
  ruleRollUp,
} from "./rules.ts";

const canon = (name: string, type = "other"): CanonicalRef => ({
  id: `id-${name}`,
  canonical_name: name,
  entity_type: type,
});

const index = new Map<string, CanonicalRef>();
for (
  const c of [
    "Toyota", "Amazon", "Capgemini", "Renault", "Volkswagen", "Nissan", "Bentley", "McLaren",
    "Hewlett Packard Enterprise", "Coca-Cola", "Emirates", "BMW", "Continental", "Bosch",
  ]
) index.set(normalize(c), canon(c));
index.set("hpe", canon("Hewlett Packard Enterprise"));

const name = (raw: string) => rollUpToParent(raw, index)?.canonical_name ?? null;

Deno.test("rolls regional, legal and plant variants up to the parent", () => {
  assertEquals(name("Toyota UK"), "Toyota");
  assertEquals(name("Toyota Manufacturing UK"), "Toyota");
  assertEquals(name("Toyota del Perú"), "Toyota");
  assertEquals(name("Toyota de Venezuela"), "Toyota");
  assertEquals(name("Toyota España"), "Toyota");
  assertEquals(name("Toyota Motor Europe"), "Toyota");
  assertEquals(name("Amazon UAE"), "Amazon");
  assertEquals(name("Amazon Manufacturing"), "Amazon");
  assertEquals(name("Capgemini Polska"), "Capgemini");
  assertEquals(name("Renault Group"), "Renault");
  assertEquals(name("Renault Argentina"), "Renault");
  assertEquals(name("Volkswagen do Brasil"), "Volkswagen");
  assertEquals(name("Nissan Motor Manufacturing UK"), "Nissan");
  assertEquals(name("Bentley Motors"), "Bentley");
  assertEquals(name("Bosch România"), "Bosch");
  assertEquals(name("Continental România"), "Continental");
  assertEquals(name("The Coca-Cola Company"), "Coca-Cola");
  assertEquals(name("Hewlett Packard Enterprise (HPE)"), "Hewlett Packard Enterprise");
});

Deno.test("leaves real sub-brands and finance arms for the LLM / review", () => {
  assertEquals(name("Amazon Web Services"), null);
  assertEquals(name("Emirates Steel Industries"), null);
  assertEquals(name("Emirates Global Aluminium"), null);
  assertEquals(name("BMW Financial Services"), null);
  assertEquals(name("BMW Bank"), null);
  assertEquals(name("Toyota Financial Services"), null);
  assertEquals(name("Toyota"), null); // exact names are already aliased
  assertEquals(name("Seat"), null);
});

const tracked = [
  "CSL Behring", "CSL Limited", "CSL Seqirus", "CSL Vifor", "Ford", "Ford Credit",
  "Ford Business Solutions", "Netflix", "Netflix Animation Studios", "Straumann Group", "DU",
  "EY", "Lincoln", "Google", "Capital Group", "Netflix House", "Warner Bros Discovery",
];
const stems = buildProtectedStems(tracked);

Deno.test("client names and their divisions are protected", () => {
  for (
    const v of [
      "CSL Behring", "CSL Behring Australia", "Csl", "CSL Plasma", "Seqirus", "Vifor Pharma",
      "Vifor Pharma Deutschland", "Behring", "Ford Credit", "Ford Motor Credit Company",
      "Ford Otosan", "Netflix Korea", "Straumann", "DU", "EY", "Lincoln Electric",
      "Google Germany", "Capital Group", "Netflix House", "YouTube (Google)",
      "Warner Bros. Discovery", "Alphabet / Google",
    ]
  ) assertEquals(isProtected(v, stems), true, v);
});

Deno.test("competitor names are not protected", () => {
  for (
    const v of [
      "Toyota UK", "Grifols", "Lonza", "Oxford Biomedica", "Ashford Group", "Dubai Holding",
      "Emirates Steel", "Renault Group", "Thermo Fisher Scientific", "Chrysler Capital",
      "Capital One Auto Finance", "Credit Acceptance", "Pixar Animation Studios",
      "House Productions", "Tesla Design",
    ]
  ) assertEquals(isProtected(v, stems), false, v);
});

Deno.test("hasParentCanonical flags likely roll-ups", () => {
  assertEquals(hasParentCanonical("Toyota Financial Services", index), true);
  assertEquals(hasParentCanonical("Grifols", index), false);
});

Deno.test("ruleRollUp rolls country arms of tracked companies, never a tracked name itself", () => {
  const idx = new Map(index);
  for (const c of ["Netflix", "CSL Behring", "Ford", "Ford Credit", "Thermo Fisher Scientific"]) {
    idx.set(normalize(c), canon(c));
  }
  const trackedExact = new Set(
    ["Netflix", "CSL Behring", "CSL Limited", "Ford", "Ford Credit", "Thermo Fisher Scientific"]
      .map((n) => normalize(n)),
  );
  const roll = (raw: string) => ruleRollUp(raw, idx, trackedExact)?.canonical_name ?? null;
  assertEquals(roll("Netflix Korea"), "Netflix");
  assertEquals(roll("CSL Behring Australia"), "CSL Behring");
  assertEquals(roll("Thermo Fisher Scientific France"), "Thermo Fisher Scientific");
  assertEquals(roll("Thermo Fisher Scientific UK"), "Thermo Fisher Scientific");
  assertEquals(roll("Ford Credit UK"), "Ford Credit");
  assertEquals(roll("CSL Limited"), null); // a tracked name is never rolled up
  assertEquals(roll("Ford Credit"), null);
  assertEquals(roll("Netflix Animation Studios"), null); // division: tail is not noise
  assertEquals(roll("Thermo Fisher Clinical"), null); // left to the review model
});

Deno.test("shortlist sends core companies plus same-first-word canonicals only", () => {
  const idx = new Map(index);
  for (const c of ["Thermo Fisher Scientific", "Thermosome", "Zurich", "Zurich Airport", "Acme Widgets"]) {
    idx.set(normalize(c), canon(c));
  }
  const aliasCounts = new Map([["id-Amazon", 50], ["id-Toyota", 40]]);
  const shortlist = buildShortlister(idx, aliasCounts, 2);
  const list = shortlist(["Thermo Fisher Clinical", "Zurich Insurance Group"]);
  assertEquals(list.includes("Amazon"), true); // core: most aliases
  assertEquals(list.includes("Toyota"), true);
  assertEquals(list.includes("Thermo Fisher Scientific"), true); // same first word
  assertEquals(list.includes("Zurich"), true);
  assertEquals(list.includes("Zurich Airport"), true);
  assertEquals(list.includes("Thermosome"), false); // different first word
  assertEquals(list.includes("Acme Widgets"), false);
});
