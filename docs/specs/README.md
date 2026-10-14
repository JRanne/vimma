# Writing a spec

A spec in `docs/specs/<name>.md` describes one feature or change before it is built. It is read by
contributors who were not part of the discussion that led to it, by the reviewer of every PR that
implements it, and by anyone trying to understand later why Vimma behaves the way it does. Write
it as finished technical documentation, not as a record of how it was decided.

Every new spec follows this page. A spec that is edited for any other reason is brought up to it
in the same PR.

## Writing rules

- **Write for an outside reader.** Assume they know Vimma's guide and Firefox's front end, but
  nothing about the conversation, issue thread or session that produced the spec. Every term
  is either in `docs/guide.md` or defined where it is first used.
- **State decisions, with their reasons.** Write "Vimma does X, because Y; Z was rejected
  because W". Do not write who asked for it, who chose it, when, or how the choice was reached.
  No "the user said", "user request", "user decision", "the coordinator", quoted chat messages
  or dates of conversations.
- **No process residue.** Agent instructions, session handovers, to-do lists for the author and
  "first draft" notes do not belong in a spec. Handover notes go in the PR description.
- **Verify every fact.** A claim about Firefox cites the engine path and line, and the Firefox
  version it was checked against. A claim about another tool (Hyprland, Omarchy, release-please)
  says the version and how it was checked. A claim about Vimma's own code cites the file. If
  something was not checked, say so.
- **Be precise.** Exact key names, pref names, file paths, limits and units. Requirements use
  **must**, **must not** and **may** where the behaviour is tested; prose explains the rest.
- **Plain, professional English.** Active voice, present tense, short sentences. No marketing,
  no filler, no emoji. Consistent with the terms in `docs/guide.md`.
- **One feature per spec.** If the scope grows past what one PR series can deliver, split it.

## Lifecycle

A spec moves through three statuses, set on its `Status:` line.

1. **Draft.** The spec merges to `main` as soon as it meets this page, with `Status: draft` and
   its open questions listed in its Open questions section. It does not wait in an open pull
   request for answers. The same change opens the feature's GitHub issue.
2. **Accepted.** Each answer is a small edit, merged at once: the answer moves into Design as a
   decision with its reason, and the question is removed. When no question is open, the status
   becomes `accepted` and the feature can be built.
3. **Implemented.** The status becomes `implemented` with the last sub-PR of its Delivery
   section.

### The feature's issue

Every planned feature has one GitHub issue. It is the backlog entry, and the roadmap in
[plan.md](../../plan.md) §6 links to it instead of describing the feature itself.

- **Title:** the feature's name.
- **Body:** a short reason for the feature, a link to the spec on `main`, and the spec's open
  questions as a numbered checklist, each with its options and a recommendation, worded as in
  the spec.
- **Labels:** `planned`, and `spec:draft` or `spec:accepted` to match the spec; `ready` once it
  can be built; others such as `security` where they apply. A milestone is optional.
- **Board:** the [Vimma roadmap](https://github.com/users/JRanne/projects/2) project tracks each
  issue as Draft, Decided, Building or Done.

The maintainer answers the questions in a comment on the issue. The answers then go into the
spec as above, and the issue's labels follow the spec's status. The implementing pull requests
reference the issue, and the last one closes it.

A pull request exists only for work that is ready to merge. Anything waiting on a decision is a
question in an issue, not an open pull request.

## Template

Copy this skeleton. Sections that do not apply stay, with one line saying why (for example "No
upstream patch.").

```markdown
# Spec: <name>

Status: draft | accepted | implemented · Area: <files and modules touched> · Upstream patches:
<none, or each new patch with its ADR-003 register line> · ADR: <links, or none>

## Summary

Two to four sentences: what changes for the user, and why it is worth doing.

## Problem

What does not work or is missing today, in product terms. Concrete examples.

## Behaviour

User stories ("As a Vimma user, ...") or a numbered list of behaviours. Each one is observable
and maps to at least one test below. Include the keys, commands and config it adds or changes.

## Research

What was checked before designing it: Firefox source (engine path:line, Firefox version), other
browsers or forks, platform facts. Only what the design depends on.

## Design

How it works: modules, data flow, state, the Firefox APIs used and why they are the right ones.
Numbered decisions, each with its reason and the alternatives rejected.

## Security and privacy

What it exposes, to whom, and what stops misuse. "No new surface" with a sentence of reasoning is
an acceptable answer.

## Tests

The acceptance criteria as test names, by layer (vitest in `vimma-core`, mochitest, e2e). They
are written first and seen to fail.

## Docs and changelog

The `docs/guide.md` sections, README lines and `CHANGELOG.md` entries the change needs.

## Delivery

The PR or sub-PRs, in order, each independently mergeable and tested.

## Open questions

Each question states the options, their trade-offs and a recommendation. When it is answered,
the answer moves into Design as a decision with its reason, and the question is removed.
```

## Before the spec is merged

- [ ] Every section of the template is present.
- [ ] No sentence depends on knowing the discussion that produced the spec.
- [ ] Every claim about Firefox or another tool cites a source and a version.
- [ ] Every behaviour has a test.
- [ ] Every open question has its options and a recommendation, and the feature's issue lists
      them.
- [ ] `npx prettier --check` passes.
