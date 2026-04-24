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

## Restore

- `backup restore --manifest-cid <cid>` — pull a specific backup by CID
- `backup restore` (no cid) — pull the latest recoverable snapshot for this agent
- `backup find-recoverable` — scan: what agents + backups could this private key restore?

## Prune

- `backup prune --keep-last <n>` — drop old incremental archives; keeps the latest chain usable

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
