# `coc-soul backup` — soul backup and restore

## First-time

- `backup init` — register the agent on SoulRegistry (if not yet registered), run a first **full** backup, write `~/.coc-backup/latest-recovery.json` with the decryption material + manifest CID.
- `backup register` — register on-chain only, do not run a backup.

## Periodic

- `backup create` — incremental (default); `--full` forces a full backup regardless of chain length.
  - `backup.autoBackup: true` + `backup.autoBackupIntervalMs` runs this on a timer inside the OpenClaw plugin.
- `backup.backupOnSessionEnd: true` + a `session_end` hook from OpenClaw also triggers `backup create` when the agent's session closes.

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
| `ENOENT ... backup/targeting.js` | extension install corrupt / mismatched | `openclaw plugins install @chainofclaw/soul --dangerously-force-unsafe-install --force` |
| `data dir not writable` | `~/.claw-mem` owned by wrong uid | 1.2.2+ auto-falls-back to `~/.openclaw/state/coc-soul`; on older versions `export CLAW_MEM_DATA_DIR=~/.openclaw/state` and restart gateway |
