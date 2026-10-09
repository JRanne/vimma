<!-- Spec: docs/specs/<name>.md · Changelog line = the commit subject; the body explains why -->

- [ ] Touches `*.patch`, `configs/`, `moz.configure` or branding → ran
      `npm run mochitest -- tests/browser/` on the full build (paste counts). PR CI uses an
      artifact build, which cannot see these (ADR-010).
