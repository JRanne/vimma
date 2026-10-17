// Experiment: same-vs-base drift for identical code, block (current) vs interleaved measurement.
const W = process.env.W;
const { CASES, reference } = await import(`${W}/packages/vimma-core/bench/cases.mjs`);
const { measure } = await import(`${W}/tools/bench/bench.mjs`);
const { combine, median } = await import(`${W}/tools/bench/compare.mjs`);
const variant = (tag) => CASES.map((c) => ({ name: tag + c.name, run: () => c.run() }));
const pick = (m, tag) => ({ machine: "m", referenceUs: m.referenceUs, cases: Object.fromEntries([...m.cases].filter(([n]) => n.startsWith(tag)).map(([n, c]) => [n.slice(tag.length), c])) });
const N = Number(process.env.N ?? 10);
for (let i = 0; i < N; i++) {
  const runs = [0, 1, 2].map(() => measure([...variant("base|"), ...variant("same|")], reference));
  const b = combine(runs.map((r) => pick(r, "base|"))), s = combine(runs.map((r) => pick(r, "same|")));
  const ch = CASES.map((c) => s.cases[c.name].ratio / b.cases[c.name].ratio - 1);
  const suite = Math.expm1(ch.reduce((a, x) => a + Math.log1p(x), 0) / ch.length);
  console.log(JSON.stringify({ suite: +(suite * 100).toFixed(1), cases: ch.map((x) => +(x * 100).toFixed(1)) }));
}
