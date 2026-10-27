# Phase docs

One doc per roadmap phase, named `phase-<n>-<short-name>.md`. The doc is the plan, the progress record, and the handoff for that phase.

## Rules

- Progress and Handoff are a current-state snapshot. Rewrite them at the end of each session. Do not append a diary.
- A task is done only when its done-check passes. Record the evidence (a file path, a command and its result) in Progress.
- Record each decision in Decisions with its reason. If a decision changes the spec, edit `docs/spec.md` in the same session and say so in the decision.
- Facts you learned the hard way go in Known facts. Facts that the code, `package.json`, or `--help` already show stay out.

## Template

```markdown
# Phase <n>: <name>

Status: Not started | In progress | Done
Last updated: <YYYY-MM-DD>

## Goal

<One paragraph. What exists at the end of this phase. Link the roadmap phase.>

## Read first

- <Spec sections, decisions, and requirements this phase touches.>

## Scope

In scope: <list>
Out of scope: <list>

## Tasks

- [ ] P<n>.1 <Task>. Done when: <observable check>.

## Known facts

<Facts about the environment and libraries that the next agent needs and cannot find by looking.>

## Decisions

| Decision | Reason | Spec changed? |
| -------- | ------ | ------------- |

## Progress

<Current state: which tasks are done, with evidence. What is half done and where it lives.>

## Handoff

Next step: <the one action the next agent takes first>
Blockers: <none, or what needs the user>
How to check the current state: <commands to run>
```
