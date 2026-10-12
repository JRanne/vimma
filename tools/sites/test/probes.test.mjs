import { describe, expect, it } from "vitest";
import { jsonLiteral, probe } from "../probes.mjs";

// probe() builds source text for the browser to evaluate, with the argument embedded as a
// literal. The literal must decode to the same value and carry no character that could end the
// surrounding code early when it is embedded elsewhere (CodeQL js/bad-code-sanitization).
describe("probe source", () => {
  const nasty = { s: "</script><!--     `${x}` \\ \" ' /", n: [1, null, true] };

  it("embeds the argument as a literal that decodes to the same value", () => {
    expect(JSON.parse(jsonLiteral(nasty))).toEqual(nasty);
  });

  it("escapes <, >, / and the line separators in the literal", () => {
    const lit = jsonLiteral(nasty);
    for (const ch of ["<", ">", "/", " ", " "]) expect(lit).not.toContain(ch);
  });

  it("uses that literal in the probe source", () => {
    const src = probe((/** @type {unknown} */ a) => a, nasty);
    expect(src).toContain(jsonLiteral(nasty));
    expect(src).not.toContain("</script>");
  });
});
