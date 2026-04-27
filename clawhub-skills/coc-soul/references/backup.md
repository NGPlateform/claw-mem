# `coc-soul backup` — soul backup and restore

## First-time

- `backup init` — register the agent on SoulRegistry (if not yet registered), run a first **full** backup, write `~/.coc-backup/latest-recovery.json` with the decryption material + manifest CID.
- `backup register` — register on-chain only, do not run a backup.

## Periodic

- `backup create` — incremental (default); `--full` forces a full backup regardless of chain length.
  - `backup.autoBackup: true` + `backup.autoBackupIntervalMs` runs this on a timer inside the OpenClaw plugin.
- `backup.backupOnSessionEnd: true` + a `session_end` hook from OpenClaw also triggers `backup create` when the agent's session closes.

### Output: `backup create` recovery summary (1.2.6+)

Every successful `backup create` prints two blocks. The first is the receipt; the second is what the user needs to restore the backup later — relay it verbatim to the user (don't swallow it):

```
Backup complete (full):
  manifest:   <cid>
  files:      <n>
  bytes:      <n>
  merkleRoot: 0x...
  txHash:     0x...           # only present if anchored on-chain

Recovery info — keep this safe to restore on another host:
  recovery package: <sourceDir>/.coc-backup/latest-recovery.json
  encryption mode:  none | privateKey | password
  signing key file: <path>    # mode 0600 — copy off-host securely
  signer address:   0x...

To restore on another host (always restore to /tmp first, verify, then promote):
  openclaw coc-soul backup restore --manifest-cid <cid> \
    --target-dir /tmp/openclaw-restore-test [ --password '<pw>' ]

  (if you also have <path>/latest-recovery.json on the target host:)
  openclaw coc-soul backup restore --latest-local --target-dir /tmp/openclaw-restore-test [ --password '<pw>' ]
```

The `--password` clause appears only when `encryption mode = password`. In `privateKey` mode, the operator must instead make sure the right key is loaded on the target host (either by copying the keystore file or by setting `backup.privateKey` in target's config).

The same fields are persisted in `<sourceDir>/.coc-backup/latest-recovery.json` (a small JSON written atomically after every backup) so the info survives even if the operator missed the terminal output:

```jsonc
{
  "version": 1,
  "agentId": "0x...",
  "latestManifestCid": "bafy...",
  "anchoredAt": 1777180566,
  "txHash": "0x...",
  "dataMerkleRoot": "0x...",
  "backupType": "full" | "incremental",
  "encryptionMode": "none" | "privateKey" | "password",
  "requiresPassword": false | true,
  "recommendedRestoreCommand": "openclaw coc-soul backup restore --latest-local --target-dir /tmp/openclaw-restore-test ..."
}
```

Treat both `latest-recovery.json` AND the signing-key file as a pair — back them up together (the manifest CID is also visible on-chain via the SoulRegistry contract, so even losing `latest-recovery.json` is recoverable from `backup find-recoverable --on-chain`, but losing the key means the encrypted payload is permanently unreadable).

## Inspect

- `backup status` — concise: chain registration state, last backup time, IPFS reachability
- `backup doctor` — structured diagnosis with actionable `recommended actions`. Use when something feels off.
- `backup list` / `backup history` — local archive table

## Restore (safety-first)

**Default: restore to `/tmp` first, verify, then promote.** Never overwrite a production directory with an unverified backup.

### Pre-restore inspection

If a local recovery package exists, read it first to know which mode + key the backup was written with:

```bash
cat ~/.openclaw/.coc-backup/latest-recovery.json
```

Capture:
- `latestManifestCid` — what to restore
- `encryptionMode` — `privateKey` | `password` | `none`
- `requiresPassword` — whether `--password` is required

### Restore commands (always to a temp dir first)

From local package:

```bash
openclaw coc-soul backup restore \
  --package /path/to/latest-recovery.json \
  --target-dir /tmp/openclaw-restore-test
```

From the latest local package (most common):

```bash
openclaw coc-soul backup restore \
  --latest-local \
  --target-dir /tmp/openclaw-restore-test
```

From a manifest CID:

```bash
openclaw coc-soul backup restore \
  --manifest-cid <CID> \
  --target-dir /tmp/openclaw-restore-test
```

### encryptionMode handling

- `encryptionMode: "password"` (or `requiresPassword: true`) → add `--password '<your-password>'`
- `encryptionMode: "privateKey"` → **do NOT pass `--password`**; ensure the right `backup.privateKey` / keystore key is loaded
- `encryptionMode: "none"` → no extra flag needed

Mismatched mode is the #1 reason `Unsupported state or unable to authenticate data` shows up. Triage that error as mode/key mismatch before suspecting tampering.

### Verify before promoting

Success criteria:
- exit code `0`
- output contains `merkleVerified: true`

If verification passes, **only then** confirm with the user before copying / moving the restored tree onto the production path.

### Cross-host restore: directory-mismatch handling

A backup made on a host where `$HOME=/home/node` will contain absolute paths like `/home/node/.openclaw/...`. Restoring on a host with `$HOME=/home/baominghao` puts those paths in the agent state where they don't exist. Rather than blindly string-replacing every occurrence (which silently corrupts SQLite binaries and rewrites historical chat content), the operator decides per-restore.

**Step 1 — detect the mismatch.** After restore-to-temp completes, scan the restored tree:

```bash
# Look for paths that don't match the current $HOME
grep -lrE '/home/[a-zA-Z_-]+/\.openclaw' /tmp/openclaw-restore-test 2>/dev/null \
  | head -20
```

If any hit is from a path that's **not** the current `$HOME`, you have a cross-host restore.

**Step 2 — explain to the user, get a decision.** Present three options:

1. **Read-only inspect** — leave paths as-is, mount the restored tree only for inspection. Useful when you just want to recover a specific file or audit history without resuming the agent.
2. **Smart rebase** (recommended for resuming the agent) — rewrite **only** runtime-config paths, leave historical content intact. See the three-class table below.
3. **Full literal overwrite** — what happens if you don't intervene; almost always wrong (corrupts history, can break SQLite).

**Step 3 — apply smart rebase.** Three classes of content, three different policies:

| Class | What it is | Examples | Policy |
|---|---|---|---|
| **A. Runtime config (paths)** | Settings the runtime reads to find files on disk now | `openclaw.json` `agentDir` / `paths.*`, `models.json` paths, `device.json`, `latest-recovery.json` `targetDir` / `sourceDir`, `context-snapshot.json` cwd refs | **Rewrite** old `$HOME` → new `$HOME`. Done structurally (JSON parse → field edit → re-emit), never via byte-level `sed` |
| **B. Historical content** | Records of past events that **were** at those paths when written | `agents/*/sessions/*.jsonl` (tool calls + outputs), `memory/main.sqlite` `observations.{narrative,facts,files_read,files_modified}`, `semantic-snapshot.json` summaries | **Leave intact**. Rewriting fakes history. claw-mem runtime never blindly opens those paths — it just searches FTS text. |
| **C. Host-local policy (CRITICAL — see auth section below)** | Settings that belong to **this** host's operator, not the agent | `gateway.auth.*`, `gateway.bind`, `gateway.port`, `plugins.allow`, host-specific provider keys in `models.json` | **Preserve target host's existing values** — don't overlay the backup's. The new host's operator already configured these for the new environment. |

The rebase routine should:
1. Parse target file as JSON / structured (not byte-level `sed`)
2. Edit only A-class fields
3. For C-class fields in `openclaw.json`, **merge** rather than overwrite: keep the target host's existing `gateway.auth.*` / `gateway.bind` / `plugins.allow` exactly; only adopt the backup's agent-portable fields
4. Skip B-class files entirely
5. Write a `rebase-report.json` next to the restored tree so operators can audit what changed

**Step 4 — auth: re-confirm before launching the gateway.**

After rebase, dump the effective `gateway.auth` and use the matching TUI invocation:

```bash
jq '.gateway.auth' ~/.openclaw/openclaw.json
```

| `auth.mode` | TUI invocation |
|---|---|
| `"token"` | `openclaw tui --token "$(jq -r .gateway.auth.token ~/.openclaw/openclaw.json)"` |
| `"password"` | `openclaw tui --password '<password>'` |
| `"trusted-proxy"` | `openclaw tui --password '<password>'` (if header-based auth fronts the gateway, trust the proxy header in dev; otherwise pass `--password`) |
| `"none"` | `openclaw tui` |

**Common pitfall**: post-restore, `openclaw tui --token "$(jq -r .gateway.auth.token openclaw.json)"` returns the literal string `null` when the active auth mode no longer has a `.token` field (e.g. `mode` is now `password` or `trusted-proxy`). The TUI dutifully sends `null` and the gateway rejects with **1008**. Always re-read `auth.mode` after restore and pick the matching flag.

### Auth-mode preservation rule (must read before any production restore)

The most common production-breaking restore mistake: backup contains `gateway.auth.mode = "token"` with a valid token from the source host; target host has been carefully configured with `mode = "trusted-proxy"` or `"password"`. A literal-overwrite restore replaces target's auth, then the operator on target can't log in anymore — and **the backup's token is for a different gateway instance, useless on this host**.

Rule: **`gateway.auth` is a property of the host, not of the agent.** It does not get restored. The smart-rebase path explicitly preserves the target host's `gateway.auth.*` block. If you must do a literal overwrite (e.g. recovering on a fresh host with no existing config), regenerate auth before starting the gateway:

```bash
openclaw gateway init --auth password
# or whatever mode the new host should use
```

### Discover what this key can restore

```bash
openclaw coc-soul backup find-recoverable --json           # local index
openclaw coc-soul backup find-recoverable --on-chain --json # walk the chain
```

## Prune

`backup prune` only touches **local archive index entries**, not IPFS pins.

```bash
openclaw coc-soul backup prune --older-than 30 --keep-latest 1 --dry-run
openclaw coc-soul backup prune --older-than 30 --keep-latest 1
```

## What gets backed up — file patterns (1.2.7+)

The backup walks `~/.openclaw/` (or the configured `backup.sourceDir`) and captures files that match a built-in classifier. Patterns explicitly support **both** the legacy root-level layout and the current `workspace/`-prefixed layout that OpenClaw uses, so the backup picks up identity / memory files no matter which version of OpenClaw wrote them.

Identity-level markdown (root **or** `workspace/`):
- `IDENTITY.md` — agent identity declaration (where the agent's name is defined)
- `SOUL.md` — soul configuration

Memory-level markdown (root **or** `workspace/`):
- `MEMORY.md`
- `USER.md`
- `RECOVERY_CONTEXT.md` (regenerated on restore)
- plus everything under `memory/*.md`

Workspace markdown / state (root **or** `workspace/`):
- `AGENTS.md`
- `workspace-state.json` (root only)

Other categories (paths fixed):
- `identity/device.json` (config, encrypted)
- `auth.json` (config, encrypted)
- `openclaw.json` (config, encrypted)
- `plugins/*/openclaw.plugin.json` (config, not encrypted)
- `agents/*/sessions/*.jsonl` + `agents/*/sessions/sessions.json` (chat)
- `memory/*.sqlite`, `memory/lancedb/*` (database, encrypted)
- `credentials/*` (config, encrypted)
- `.coc-backup/context-snapshot.json`, `.coc-backup/semantic-snapshot.json` (auto-generated metadata)

Files outside this whitelist are not backed up. If you put important state in `~/.openclaw/<custom-dir>/` and the path doesn't match any pattern above, it will be silently skipped — extend the pattern set in `src/backup/change-detector.ts` and bump soul minor version if you need a new shape covered.

**Pre-1.2.7 note for upgraders**: earlier versions only matched root-level `IDENTITY.md` etc. and would skip `workspace/IDENTITY.md`, leaving restored agents nameless. After upgrading to 1.2.7+ the next `backup create --full` will pick these files up; verify by checking `backup list --json` for the new manifest's file count, then test-restore to `/tmp` and confirm `workspace/IDENTITY.md` shows up in the restored tree.

## Categories & semantic snapshot

`backup.categories.*` controls what gets bundled:

- `identity` — DID + keys
- `config` — OpenClaw / claw-mem config
- `memory` — SQLite memory DB
- `chat` — conversation history
- `workspace` — agent's working dir
- `database` — other DBs

`backup.semanticSnapshot` controls the compressed "agent context" snapshot included with each backup:

- `enabled` (default `true`) — pack a token-budgeted summary of memory
- `tokenBudget` (default 8000)
- `maxObservations` / `maxSummaries`

## Encryption

- `backup.encryptMemory: true` + `backup.encryptionPassword` — AES-GCM encrypt memory before IPFS upload
- Without encryption, backups are still integrity-checked via Merkle root but readable by anyone who fetches the CID

## Resurrection prep

- `backup configure-resurrection --resurrection-key-hash <bytes32> --max-offline-duration <seconds>` — set the "trigger" for an automatic resurrection request
- `backup heartbeat` — send a heartbeat so automatic resurrection doesn't fire

After both are set, verify with `backup doctor --json` — `resurrection.configured` must be `true`.

## CID + key disambiguation

| Term | What it is | Where it shows up |
|---|---|---|
| `latestManifestCid` | Latest restore point | `latest-recovery.json`, `backup status` |
| older full CID | Historical baseline restore point | `backup history` |
| identity CID / hash | Identity-content hash from registration | DID write commands — **not** a restore point |

Private keys (owner / resurrection / guardian) are **never** chat-safe. Don't transmit even split / encrypted fragments via chat.

## Failure-mode triage

| Symptom | Likely cause | Action |
|---|---|---|
| `Unsupported state or unable to authenticate data` | encryption mode / key mismatch | Re-read `latest-recovery.json` `encryptionMode` and use the matching `--password` (or none) |
| `429 rate limit exceeded` | IPFS gateway rate-limited | Retry with exponential backoff until `merkleVerified: true` |
| restore unavailable / blocked | chain not registered or no manifest | Run `backup doctor --json`; fix `chain.registered` first |
| `[gateway] unauthorized (1008)` | gateway auth / proxy mode wrong | Fix gateway auth (token / OAuth / proxy) before scheduled `heartbeat` |
| `[gateway] unauthorized (1008)` **right after restore** | restore overwrote `gateway.auth.mode` (was `token`, now `trusted-proxy` / `password`); old TUI command sends literal `null` token | `jq '.gateway.auth.mode' ~/.openclaw/openclaw.json` to see active mode; switch TUI invocation per the auth-mode table above. If smart-rebase wasn't used, restore target host's `gateway.auth.*` from the pre-restore backup at `~/.openclaw/.restore-overwrite-backup-*/openclaw.json` |
| Cross-host restored agent has stale paths in chat / observations | literal overwrite was used, OR smart-rebase ran on B-class history files (it shouldn't) | Roll those files back from `.restore-overwrite-backup-<ts>/` and re-run with smart-rebase scoped to A-class only |
| SQLite `PRAGMA integrity_check` reports errors after a manual rewrite | byte-level `sed` on `memory/main.sqlite` corrupted page offsets (string lengths changed) | Roll back `memory/main.sqlite` from backup, then use `UPDATE observations SET narrative = REPLACE(narrative, '<old>', '<new>')` etc. inside `sqlite3` (length-safe) and rebuild FTS: `INSERT INTO observations_fts(observations_fts) VALUES('rebuild')` |
| `ENOENT ... backup/targeting.js` | extension install corrupt / mismatched | `openclaw plugins install @chainofclaw/soul --dangerously-force-unsafe-install --force` |
| `data dir not writable` | `~/.claw-mem` owned by wrong uid | 1.2.2+ auto-falls-back to `~/.openclaw/state/coc-soul`; on older versions `export CLAW_MEM_DATA_DIR=~/.openclaw/state` and restart gateway |
