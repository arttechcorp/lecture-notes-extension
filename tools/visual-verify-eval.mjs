#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const [repoRootArg, outJsonArg] = process.argv.slice(2);

if (!repoRootArg || !outJsonArg) {
  console.error("Usage: node tools/visual-verify-eval.mjs <repoRoot> <outJson>");
  process.exit(1);
}

const repoRoot = path.resolve(repoRootArg);
const outJson = path.resolve(outJsonArg);

const req = createRequire(import.meta.url);
const figuresPath = path.resolve(repoRoot, "lib/figures.js");
const verifyPath = path.resolve(repoRoot, "lib/verify.js");

const Figures = req(figuresPath);
const V = req(verifyPath);

const casesDef = [
  // Chart cases
  {
    id: "chart-accept-1",
    kind: "chart",
    expect: "accept",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [10, 20] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A 10 B 20",
  },
  {
    id: "chart-accept-2",
    kind: "chart",
    expect: "accept",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [-10, 20] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A -10 B 20",
  },
  {
    id: "chart-accept-3",
    kind: "chart",
    expect: "accept",
    data: {
      type: "bar",
      categories: ["A", "B", "C"],
      series: [{ name: "v", values: [3, 5, 7] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A 3 B 5 C 7",
  },
  {
    id: "chart-block-1",
    kind: "chart",
    expect: "block",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [-10, 20] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A 10 B 20",
  },
  {
    id: "chart-block-2",
    kind: "chart",
    expect: "block",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [20, 10] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A 10 B 20",
  },
  {
    id: "chart-block-3",
    kind: "chart",
    expect: "block",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [10, 20] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "0 10 20",
  },
  {
    id: "chart-block-4",
    kind: "chart",
    expect: "block",
    data: {
      type: "bar",
      categories: ["A", "B"],
      series: [{ name: "v", values: [10, 20] }],
      xLabel: "항목",
      yLabel: "값",
    },
    ocrText: "A 10",
  },

  // Formula cases
  {
    id: "formula-accept-1",
    kind: "formula",
    expect: "accept",
    latex: "x+y=3",
    source: "x+y=3",
  },
  {
    id: "formula-accept-2",
    kind: "formula",
    expect: "accept",
    latex: "\\frac{a}{b}",
    source: "a/b",
  },
  {
    id: "formula-accept-3",
    kind: "formula",
    expect: "accept",
    latex: "E=mc^2",
    source: "E=mc^2",
  },
  {
    id: "formula-block-1",
    kind: "formula",
    expect: "block",
    latex: "x-y=3",
    source: "x+y=3",
  },
  {
    id: "formula-block-2",
    kind: "formula",
    expect: "block",
    latex: "x=3",
    source: "x<3",
  },
  {
    id: "formula-block-3",
    kind: "formula",
    expect: "block",
    latex: "a\\times b",
    source: "a\\div b",
  },
];

const evaluatedCases = casesDef.map(c => {
  let got = "block";
  if (c.kind === "chart") {
    const ok = Figures.isSimpleChart(c.data, { ocrText: c.ocrText });
    got = ok ? "accept" : "block";
  } else if (c.kind === "formula") {
    const res = V.checkFormulaSymbols(c.latex, c.source);
    got = res === "match" ? "accept" : "block";
  }

  return {
    id: c.id,
    kind: c.kind,
    expect: c.expect,
    got,
  };
});

let acceptedOk = 0;
let blockedOk = 0;
let falseApprove = 0;
let falseHold = 0;

for (const c of evaluatedCases) {
  if (c.expect === "accept" && c.got === "accept") acceptedOk++;
  else if (c.expect === "block" && c.got === "block") blockedOk++;
  else if (c.expect === "block" && c.got === "accept") falseApprove++;
  else if (c.expect === "accept" && c.got === "block") falseHold++;
}

const summary = {
  falseApprove,
  falseHold,
  total: evaluatedCases.length,
  blockedOk,
  acceptedOk,
};

const output = {
  cases: evaluatedCases,
  summary,
};

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(output, null, 2), "utf-8");

console.log(JSON.stringify(summary));
