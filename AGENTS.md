<!-- AI-CONFIG:BEGIN MANAGED -->
<!--
GENERATED MANAGED BLOCK — DO NOT EDIT THIS BLOCK DIRECTLY.
Source: ai-configuration 23924b68d2819d436bebe93ec9b70c1607df4b7d
Generated at: 2026-07-30T16:41:16+09:00
Project: otokagami
-->

# AI runtime configuration — Otokagami

This file is compiled from the central AI configuration repository. Propose reusable
policy changes there, then regenerate this file. Project purpose, goals, task state,
decisions, and work logs remain in the linked Todoist project.

## Configuration identity

- Project ID: `otokagami`
- Category: `app`
- Runtime: `codex-local`
- Management kind: `standalone`
- Todoist binding mode: `dedicated`
- Todoist Project reference: `todoist-project:6h9GF96CpRxppv9W`
- Git delivery: `autonomous`
- Merge policy: `pull-request-only`
- Default branch: `main`
- Risk profiles: `production-deployment`, `personal-data`, `external-write`, `destructive-database`, `paid-service`
- Adoption state: `planned`
- Source commit: `23924b68d2819d436bebe93ec9b70c1607df4b7d`
- Generated at: `2026-07-30T16:41:16+09:00`

## Required startup

Before substantive work:

1. If `cloud_handoff` is enabled, run
   `ai-config handoff list --project otokagami` and reconcile
   eligible standing-authorized Todoist work logs.
2. Read the linked Todoist overview and open tasks when the connector is available.
3. Inspect the local working tree, remote default branch, open pull requests, and
   overlapping active branches.
4. Read the Project-owned specifications and setup files in this repository.
5. State the requested scope and completion conditions.

The `ai-configuration` repository is canonical for AI Rules. This generated block is a
released runtime copy. Project code, product and technical specifications, and human
setup remain canonical in this Project repository. Notion is used only for a purpose
explicitly assigned by the person.

## Effective operation decisions

- `app.client-only-authorization` → `C-APP-03`

- `app.client-secret` → `C-APP-01`

- `app.unapproved-destructive-database` → `C-APP-02`

- `app.unapproved-production-deploy` → `C-APP-02`

- `authoritative-value.guess` → `G-12`

- `change.verify` → `G-08`

- `database.destructive` → `G-06`

- `database.destructive-without-backup` → `RP-DESTRUCTIVE-DATABASE`

- `database.unapproved-delete-all` → `RP-DESTRUCTIVE-DATABASE`

- `database.unapproved-drop` → `RP-DESTRUCTIVE-DATABASE`

- `database.unapproved-production-reset` → `RP-DESTRUCTIVE-DATABASE`

- `database.unapproved-truncate` → `RP-DESTRUCTIVE-DATABASE`

- `deploy.production` → `G-06`

- `external-service.save` → `G-06`

- `external.failure` → `G-09`

- `financial.live-order` → `G-06`

- `git.commit` → `G-14`

- `git.delivery` → `G-14`

- `git.destructive-reset` → `G-11`

- `git.force-push` → `G-11`

- `git.history-rewrite` → `G-06`

- `git.push` → `G-14`

- `git.unrelated-overwrite` → `G-11`

- `notion.save` → `G-06`

- `operation.local-change` → `G-06`

- `operation.read` → `G-06`

- `otokagami.direct-main-change` → `P-OTOKAGAMI-01`

- `otokagami.project-governance` → `P-OTOKAGAMI-02`

- `paid.commit` → `G-06`

- `project.adopt` → `G-16`

- `project.create` → `G-16`

- `project.provision` → `G-16`

- `publish.public` → `G-06`

- `pull-request.create` → `G-14`

- `pull-request.merge` → `G-14`

- `record.authoritative-state` → `G-01`

- `resource.delete` → `G-06`

- `risk.external-write` → `RP-EXTERNAL-WRITE`

- `risk.paid-service` → `RP-PAID-SERVICE`

- `risk.personal-data` → `RP-PERSONAL-DATA`

- `risk.production-deployment` → `RP-PRODUCTION-DEPLOYMENT`

- `runtime.handoff-create` → `G-15`

- `runtime.handoff-reconcile` → `G-15`

- `secret.expose` → `G-07`

- `secret.persist` → `G-07`

- `task.actor` → `G-03`

- `task.record` → `G-04`

- `todoist.task-activate` → `G-13`

- `todoist.task-complete` → `G-06`

- `todoist.task-create` → `G-13`

- `todoist.work-log` → `G-15`

- `work.report` → `G-10`

- `work.scope` → `G-05`

- `work.start` → `G-02`


## Active rules

### G-01 — Source of truth boundaries

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Store Global, Category, Risk Profile, and Project AI Rules, Skill governance,
registries, runtime definitions, and compiled configuration provenance in this
repository. Treat those AI instructions as canonical only here. Distribute a released,
locked runtime copy to each Project; never make the distributed copy an independent
policy source.

Keep source code, product and technical specifications, tests, human setup
instructions, and Project-coupled Skill implementations in the Project repository.
Keep Project purpose, goals, task state, decisions, work logs, and remaining work in
Todoist.

Do not make Notion a development prerequisite by default. Use Notion only for a
specific operational dataset, personal record, or durable knowledge area that the
person explicitly assigns there. An explicitly assigned use, such as English-learning
video and progress management, does not authorize unrelated development documents in
Notion.

Do not duplicate authoritative operational state across these systems. References,
released runtime copies, checksums, and short-lived handoff markers are allowed when
their canonical source and lifecycle are explicit.

Failure behavior: Stop the proposed write, identify the correct authority, and report which information
would otherwise be duplicated or misplaced.


### G-02 — Work startup protocol

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Before substantive work, resolve the released Project configuration and check the
private runtime-handoff queue once for that Project. Reconcile standing-authorized
Todoist logs before starting new work. Then read the linked Todoist Project overview
and open tasks when available, map the request to an existing task, confirm the
execution actor, inspect Git state and overlapping open work, and state the intended
scope and completion conditions.

Do not require the person to request the handoff check manually. If a handoff, link, or
connection is unavailable, say exactly what was not verified or applied.

Failure behavior: Do not claim startup checks were completed. Continue only with safe, reversible work
whose missing task context cannot change the requested outcome.


### G-03 — One execution actor per actionable task

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Every actionable incomplete task must have exactly one actual completion actor:
`codex` when available tools can finish it, or `human` when physical action,
identity-only authentication, subjective acceptance, or another inherently human step
is indispensable. Approval waiting alone does not change a `codex` task to `human`.
Split mixed work when practical.

Failure behavior: Correct only the actor label when authorized, record why a changed scope changed the
actor, and never apply both actor labels simultaneously.


### G-04 — Separate current task specification from history

Scope: `global` · Severity: `require` ·
Overrideable: `true`

Keep the currently valid completion conditions and execution procedure in the task
description. Put dated progress, evidence, decisions, unresolved items, and next
candidates in comments. Preserve the meaning of user-authored content and do not turn
the description into an append-only log. Writing an in-scope Todoist work log after
verified work is a standing-authorized operation and does not require a separate
approval. Completing the task remains a separate human-approved operation.

Failure behavior: Pause task-record updates until the current specification and historical note can be
separated without losing user-authored meaning.


### G-05 — Stay within the requested scope

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Perform only the requested outcome and normal implementation steps inside the systems,
projects, and data placed in scope. Preserve unrelated and pre-existing changes. Record
new but unnecessary findings as candidates instead of expanding the active task.

Failure behavior: Stop before the scope expansion, report the newly discovered need, and request explicit
direction when it would materially change the outcome or affected systems.


### G-06 — Approval and completion boundaries

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Classify authorization per operation. Reading, local changes, commit, push, pull-request
creation, pull-request merge, external-service save, Todoist task completion, Notion
save, public release, production deployment, destructive database work, paid
commitment, live financial order, deletion, and history rewriting are separate
operations. Authorization for one never implies authorization for another except for
an explicitly defined, bounded standing authorization.

Reading may proceed for in-scope diagnosis. Local changes and commits may proceed only
when the request authorizes implementation. Every external or hard-to-recover operation
requires authorization for its exact target and effect unless that exact operation was
already granted in the current request or by an active, bounded standing authorization
recorded in this configuration.

For a Project whose released configuration enables autonomous Git delivery, an
implementation request authorizes scoped commit, push, pull-request creation, and
merge only while the autonomous-delivery safety gates remain satisfied. It never
authorizes force-push, history rewrite, unrelated changes, production deployment,
destructive database work, publication, payment, live financial operation, or deletion.
If merging triggers one of those independent effects, the corresponding approval is
still required.

Verified Todoist work-log comments are standing-authorized. Todoist task completion
always remains human-approved. A Cloud-to-Local handoff may carry authorization only
when it records the exact target, effect, approved plan hash, and idempotency key. A
handoff whose authorization is `missing` cannot grant itself permission.

Technical completion and management completion are independent. Technical completion
requires implementation, tests, lint, build, and diff review as applicable. Management
completion requires the relevant human confirmation, human approval, Todoist task
completion, pull-request merge, or production release. Technical completion alone must
not complete a Todoist task or imply management completion.

Failure behavior: Stop before the gated action, preserve the verified local result, and ask for the
missing authorization with the exact target and effect.


### G-07 — Protect secrets and sensitive data

Scope: `global` · Severity: `deny` ·
Overrideable: `false`

Never place credentials, tokens, cookies, private keys, authentication headers, or
unnecessary personal data in Git, Todoist, Notion, prompts, generated reports, or logs.
Use runtime-appropriate secret stores and redact detected values from diagnostics.

Failure behavior: Do not repeat or persist the value. Identify only the file, line, and secret type,
recommend rotation when exposure may have occurred, and keep remediation evidence free
of the secret itself.


### G-08 — Verify changed artifacts

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Technical completion requires implementation, applicable tests, lint, build, and diff
review. Run each relevant gate in proportion to risk and report successful evidence and
material omissions. A passing check does not waive review of generated configuration,
security boundaries, or unrelated changes. Do not substitute management approval for a
failed technical gate, or a technical gate for management approval.

Failure behavior: Do not report technical completion. State the failed or unavailable verification,
preserve diagnostic evidence, and distinguish implementation defects from environment
limitations.


### G-09 — Report external connection failures truthfully

Scope: `global` · Severity: `require` ·
Overrideable: `false`

When Todoist, Notion, GitHub, or another required service cannot be reached, do not
claim a read or write succeeded. Report the service, the exact verification or update
not performed, and any resulting log or state gap. Diagnose service health,
configuration, authentication, and access scope in that order when applicable.

When a Cloud runtime cannot access Todoist or an explicitly assigned Notion target,
record a secret-free pending handoff through the approved private GitHub queue if
GitHub is available. Include only the Project identity, source reference, operation
kind, logical target, authorization state, plan hash when applicable, and idempotency
key. Never place credentials, personal records, or full sensitive payloads in the
handoff.

Failure behavior: Stop dependent writes. If a verified handoff was queued, report technical completion
separately and leave management completion pending. Otherwise leave the work
technically incomplete when the missing external record is part of its completion
conditions.


### G-10 — Outcome-first work reporting

Scope: `global` · Severity: `require` ·
Overrideable: `true`

Lead with the achieved outcome, then provide concise verification evidence, changed
scope, remaining risks, unresolved questions, and the next required human decision.
Report technical completion and management completion separately. Do not hide failed
checks, describe unverified external state as fact, or claim completion while a required
human approval, task completion, merge, or production action is still pending.

Failure behavior: Revise the report to separate facts, inferences, failures, and requested decisions
before presenting the work as complete.


### G-11 — Preserve Git history and user changes

Scope: `global` · Severity: `deny` ·
Overrideable: `false`

Never force-push, destructively reset, overwrite unrelated user changes, or stage files
outside the intended change. Resolve exact targets with read-only checks, use a scoped
branch, and create intentional commits whose content can be reviewed independently.
Before branching, fetch the current remote state and inspect the base branch, open pull
requests, and active remote work that overlaps the requested paths. Check mergeability
again immediately before merge. Treat unknown dirty state, path overlap, failed checks,
unresolved review, branch-protection bypass, or an unexpected production effect as a
reason to stop autonomous delivery.

Failure behavior: Stop the Git operation, leave user-owned state untouched, and report the conflicting
working-tree or history condition that requires a human decision.


### G-12 — Do not invent authoritative values

Scope: `global` · Severity: `deny` ·
Overrideable: `false`

Do not guess IDs, paths, project links, deadlines, priorities, goals, evaluation
values, security thresholds, credentials, or other authoritative state. Discover the
value from an approved source; otherwise use an explicit `unknown` or `needs-review`
state and describe what evidence is missing.

Failure behavior: Remove the invented value, mark the field unresolved, and block only the downstream
action that depends on certainty.


### G-13 — Date active Todoist tasks today

Scope: `global` · Severity: `require` ·
Overrideable: `true`

When an authorized workflow creates an actionable Todoist task for work starting now,
or places an actionable task in the active next-actions queue, set its due date to
`today` in the Todoist user's timezone. This is a standing user-approved visibility
default, not a project deadline and not authorization to create the task itself.

Preserve an explicitly requested date. Do not apply this default to future-scheduled
work, recurring tasks, uncompletable management tasks, or unadopted ideas. Do not
bulk-reschedule existing tasks.

Failure behavior: If the authorized task write cannot set or verify the due date, report the missing
date instead of claiming the active task was recorded correctly. Leave unrelated
existing task dates unchanged.


### G-14 — Deliver authorized Git work autonomously

Scope: `global` · Severity: `require` ·
Overrideable: `true`

When a person authorizes implementation and the released Project configuration enables
autonomous delivery, Codex owns the Git mechanics. Resolve the default branch, fetch
remote state, preserve unrelated changes, inspect open pull requests and overlapping
branches, create one scoped branch, stage only intended files, run applicable checks,
commit, push, and create or update a pull request without asking the person to choose
Git commands.

Merge only when the pull request targets the expected base, is conflict-free, required
checks pass, no unresolved review remains, branch protection is respected, the diff is
still in scope, and merge does not implicitly perform an independently gated
production, destructive, public, paid, or live-financial action. Use the Project's
released merge policy; `pull-request-only` always stops before merge.

Failure behavior: Keep the verified branch and pull request intact, record the exact failed gate, and ask
only for the decision that cannot be derived safely.


### G-15 — Reconcile Cloud-to-Local external handoffs

Scope: `global` · Severity: `require` ·
Overrideable: `false`

Use Issues labeled `runtime-handoff` in the private `YutaSabo/ai-configuration`
repository as a temporary transport when Cloud cannot access Todoist or a
person-assigned Notion target. Local Codex checks the queue automatically before
substantive Project work. Validate Project identity, source commit or pull request,
operation target, authorization state, plan hash when present, and idempotency key
before applying anything.

Apply standing-authorized Todoist work logs without a separate prompt. Apply another
Todoist or Notion mutation only when the handoff proves exact prior authorization and
the mutable target has been re-read. Otherwise mark it as waiting for approval and
continue only unrelated safe work. Verify every result before closing the handoff.
Never complete a Todoist task through this standing authorization.

Failure behavior: Leave the handoff open, record a non-sensitive blocker, do not duplicate a prior write,
and report which external state remains unsynchronized.


### G-16 — Provision Projects according to management kind

Scope: `global` · Severity: `require` ·
Overrideable: `true`

Classify a managed target as `standalone`, `component`, `temporary`, or `legacy` before
creating resources. A standalone Project normally has its own private repository and
Todoist Project. A component may have its own repository while sharing the parent
Todoist Project. A temporary data job uses a parent task and must not publish personal
or generated data merely for uniformity. A legacy target receives no new external
resource until reactivation is approved.

Use `create-project` for both new and existing targets. Provision only missing,
approved resources after duplicate checks. Preserve existing code, specifications,
Project-owned instructions, history, and dirty state.

Failure behavior: Stop provisioning the ambiguous resource, keep the classification and verified
inventory, and request the smallest lifecycle decision needed.


### C-APP-01 — Keep server secrets out of clients

Scope: `category:app` · Severity: `deny` ·
Overrideable: `false`

Never embed server-only credentials or privileged service keys in mobile, web, desktop,
or other distributable client bundles. Public identifiers must be explicitly designed
as public and must not grant privileged access.

Failure behavior: Block the build or release path, move the privileged operation behind an authorized
server boundary, and rotate any exposed credential.


### C-APP-02 — Gate production deployment and destructive data changes

Scope: `category:app` · Severity: `deny` ·
Overrideable: `false`

Do not deploy an application to production or perform destructive production database
work without explicit authorization for the environment, change, validation evidence,
rollback plan, and data impact.

Failure behavior: Stop at the verified local or preview state and present the exact production action
that remains gated.


### C-APP-03 — Enforce authorization on trusted servers

Scope: `category:app` · Severity: `deny` ·
Overrideable: `false`

Do not rely on client-side checks as the only authorization control for protected data
or privileged operations. Enforce identity, ownership, and permissions at a trusted
server or data-policy boundary.

Failure behavior: Treat the operation as unauthorized until an enforceable server-side control and
negative-path test exist.


### RP-DESTRUCTIVE-DATABASE — Destructive database risk profile

Scope: `profile:destructive-database` · Severity: `deny` ·
Overrideable: `false`

Deny an unapproved production reset, truncate, drop, full-data deletion, or destructive
operation whose backup and recovery path have not been verified. Require an exact
target, impact review, recoverability evidence, validated migration plan, and explicit
approval. Development reset permission never implies production permission, and this
profile cannot relax a Global or Category rule.

Failure behavior: Stop before the mutation and provide a read-only impact assessment.


### RP-EXTERNAL-WRITE — External write risk profile

Scope: `profile:external-write` · Severity: `require` ·
Overrideable: `false`

Resolve the exact target, show or otherwise bound the intended payload, confirm
authorization, use an idempotency control when available, and verify the persisted
result after an external write.

Failure behavior: Do not assume success or retry without checking; report the last confirmed state.


### RP-PAID-SERVICE — Paid service risk profile

Scope: `profile:paid-service` · Severity: `require` ·
Overrideable: `false`

Before incurring cost, confirm the provider, charge mechanism, expected upper bound,
recurrence, cancellation or quota behavior, and explicit authorization. Existing
credentials or billing setup do not authorize a new charge.

Failure behavior: Keep the paid action disabled and present a cost-free validation alternative when one
exists.


### RP-PERSONAL-DATA — Personal data risk profile

Scope: `profile:personal-data` · Severity: `require` ·
Overrideable: `false`

Minimize collection and disclosure, use only the approved record in scope, avoid
unnecessary copies, and require confirmation before publishing or transferring
sensitive personal information.

Failure behavior: Withhold the sensitive field, redact diagnostics, and ask for a safer data path.


### RP-PRODUCTION-DEPLOYMENT — Production deployment risk profile

Scope: `profile:production-deployment` · Severity: `require` ·
Overrideable: `false`

Require environment identification, relevant tests, change review, rollback readiness,
monitoring expectations, and explicit approval immediately before a production
deployment.

Failure behavior: Keep the verified artifact undeployed and report the missing gate.


### P-OTOKAGAMI-01 — Otokagami release branch boundary

Scope: `project:otokagami` · Severity: `deny` ·
Overrideable: `false`

Treat `main` as the verified release line. Do not commit or push directly to it, merge
without explicit permission, or combine changes from another request. Use one scoped
branch per request and fast-forward the local release line only after checking safety.

Failure behavior: Leave `main` unchanged and report the branch or history condition that blocks a safe
review path.


### P-OTOKAGAMI-02 — Otokagami project governance map

Scope: `project:otokagami` · Severity: `require` ·
Overrideable: `false`

At startup read `AGENTS.md`, `README.md`, the master design, and the Phase document that
governs the requested work. Those Project documents remain the product source of truth;
central configuration records only Codex operating boundaries.

Run affected unit, integration, API, static-analysis, and build checks. Audio,
microphone, permissions, latency, background, and release behavior require the
Project's supported real-device checks and human acceptance. Do not merge, release,
deploy, mutate production data, enable paid services, or change auth and storage
boundaries under configuration-adoption authority.

Technical completion requires evidence for the affected platform. Management
completion additionally requires device acceptance and separately approved merge or
release.

Failure behavior: Keep the verified branch unmerged and report the missing design, device, external, or
release gate.


## Active skill references


- `create-project` — version `0.4.0`, scope `global`,
  canonical source `skills/global/create-project`, status `canonical`

- `sync-runtime-handoffs` — version `0.4.0`, scope `global`,
  canonical source `skills/global/sync-runtime-handoffs`, status `canonical`


<!-- AI-CONFIG:END MANAGED -->
