# Distill Support Answer Assistant

Distill is a local support-answer assistant that turns Q&A logs into reviewable decision maps, then uses those maps to route a customer question to a root cause and answer draft.

## OKF-First Knowledge Model

The canonical internal knowledge store is an Open Knowledge Format bundle under `.data/okf`. The server still exposes maps to the UI as `map.nodes` and `map.edges`, but that object shape is a compiled view of the OKF bundle, not the design center of the storage model.

This follows OKF v0.1's core constraints:

- A knowledge bundle is a directory tree of Markdown files.
- Every non-reserved `.md` file is one concept with YAML frontmatter.
- Every concept has a non-empty `type`.
- `index.md` and `log.md` are reserved navigation/history files.
- Producer-defined frontmatter keys are allowed and must be preserved by tolerant consumers.

The app uses those extension points for decision-map behavior that OKF intentionally does not standardize.

## Bundle Layout

```text
.data/okf/
  index.md
  log.md
  workspaces/
    index.md
    support.md
  maps/
    index.md
    login-auth.md
  nodes/
    login-auth/
      index.md
      root.md
      q1.md
      l1.md
  references/
    qa/
      login-auth/
        l1-1.md
```

Concept roles:

- `Support Workspace`: a product, department, or support use case.
- `Support Decision Map`: a traversable answer map.
- `Support Symptom`: an entry concept for an initial user problem.
- `Decision Question`: a branch point that can be assigned to an agent or subagent.
- `Root Cause`: a terminal concept with the answer draft and escalation guidance.
- `Reference`: source Q&A evidence cited by a node.

## Distill Extension Schema

Each app-owned concept declares:

```yaml
okf_version: "0.1"
app_schema: distill-support-map/v1
```

The `distill-support-map/v1` extension stores UI and traversal fields that are outside OKF's minimal standard:

- `map_id`, `workspace_id`, `node_id`
- `node_kind`: `symptom`, `question`, or `leaf`
- `status`: `draft`, `review`, `published`, or `rejected`
- `position`: canvas coordinates used by the current UI
- `metrics`: resolved/unresolved feedback counters
- `source_qa`: normalized evidence copied from imported Q&A logs
- `outcomes`: outgoing branches with `label`, `condition`, `to`, and `to_node_id`
- `incoming`: inbound branch references for navigation and auditing

OKF links are intentionally untyped, so branch semantics live in `outcomes` and are repeated in the Markdown body. This keeps the bundle conformant while making branch selection explicit for agents.

## Agent Traversal Contract

Agents should treat the bundle as progressively disclosed knowledge:

1. Read `index.md`.
2. Select a `Support Decision Map`.
3. Start at the map's `root_node_id`.
4. For each node, read only that concept, its `outcomes`, and cited references needed for the decision.
5. A subagent assigned to a `Decision Question` chooses one outcome with confidence, or asks `next_question` when the branch is ambiguous.
6. When a `Root Cause` is reached, use `answer`, cite `source_qa` references, and apply `escalation` only when its condition matches.

This design avoids handing a whole large graph to one model call. Each branch can be delegated to a small worker that has a tight, auditable context.

## Runtime Compatibility

The browser UI still edits the same concepts it did before:

- Adding a node creates a new OKF node concept and an `outcomes` entry on the parent.
- Editing a branch updates the source node's `outcomes`.
- Dragging a node updates the concept's `position`.
- Publishing/reviewing updates `status`.
- Feedback updates `metrics` and can return a published node to review.

For compatibility and debugging, the server also writes `.data/maps.json` as a mirror. On startup, `.data/okf` is preferred when present; the JSON mirror is only a migration fallback.

## Export

`GET /api/maps/:id/export?format=okf` returns a JSON envelope containing the OKF files for that map. The on-disk `.data/okf` directory remains the canonical internal bundle.

Other export formats remain available for existing workflows:

- `format=json`
- `format=csv`
- `format=skill`
