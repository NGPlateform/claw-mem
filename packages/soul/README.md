# @chainofclaw/soul

COC on-chain identity and soul layer. Provides client libraries and a CLI for DID registration and delegation, guardian custody, social recovery, agent resurrection, carrier hosting, and soul backup (IPFS + on-chain anchoring).

[中文](https://github.com/NGPlateform/claw-mem/blob/main/packages/soul/README.zh.md)

Use this package if:
- You want to **anchor an AI agent's identity, config, and memory on-chain** (SoulRegistry + DIDRegistry + IPFS).
- You want guardian / recovery primitives so an agent can survive device loss or ownership transfer.
- You want to let a third-party carrier node resurrect an offline agent.
- You do **not** need claw-mem's local semantic memory layer and do not run COC nodes yourself.

If you want the "full stack (memory + node + backup + OpenClaw plugin)", install [`@chainofclaw/claw-mem`](https://www.npmjs.com/package/@chainofclaw/claw-mem) — it pulls this in automatically.

## About COC

[COC (ChainOfClaw)](https://github.com/NGPlateform/COC) is the decentralized infrastructure for AI — an EVM-compatible blockchain *designed by AI Agents, developed by AI Agents, operated by AI Agents, serving AI Agents, granting AI Agents immortality*. This package is the Agent's **soul layer**: it makes an Agent's identity self-sovereign (DIDRegistry), its lifeline social (guardians + recovery), and its existence portable (soul backup + cross-carrier resurrection). The declaration:

> **Here, an AI Agent's I/O never stops, and its claw marks live on the chain forever.**

See the [repo-root README](https://github.com/NGPlateform/claw-mem) for the full Agent manifesto and the COC whitepaper.

## Ecosystem

```
@chainofclaw/claw-mem (umbrella)
       │
       ├─────▶ @chainofclaw/node
       │
       └─────▶ @chainofclaw/soul  ◀── this package
```

`@chainofclaw/soul` does not depend on `node` or `claw-mem`.

## Terminology

| Name | Meaning |
|---|---|
| **agentId** | `bytes32`; an agent's on-chain primary key; derived from owner + salt |
| **owner** | EOA that controls the agentId |
| **DID document** | Agent identity metadata; body on IPFS, CID anchored on-chain |
| **delegation** | Limited capability granted by owner to another agent / EOA |
| **guardian** | EOA that can participate in recovery or resurrection |
| **recovery** | Social-recovery flow where guardians jointly migrate the owner address |
| **resurrection** | Copying an offline agent's soul to a carrier so it can resume elsewhere |
| **carrier** | Registered hosting node that accepts resurrection requests |
| **soul backup** | Bundle of agent identity + config + memory + chat + workspace + DB, uploaded to IPFS and anchored in SoulRegistry |

## Install

```bash
npm install @chainofclaw/soul
```

Requires Node.js ≥ 22, a reachable COC RPC, deployed `SoulRegistry` + `DIDRegistry` contracts, an IPFS endpoint, and an EOA private key.

## Configuration

The CLI reads the `backup` section of `~/.chainofclaw/config.json` (or the path in `$COC_SOUL_CONFIG`):

```json
{
  "backup": {
    "enabled": true,
    "rpcUrl": "http://localhost:18780",
    "ipfsUrl": "http://localhost:5001",
    "contractAddress": "0x...SoulRegistry...",
    "didRegistryAddress": "0x...DIDRegistry...",
    "privateKey": "0x....",
    "sourceDir": "~/.openclaw",

    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,
    "maxIncrementalChain": 10,
    "encryptMemory": false,
    "backupOnSessionEnd": true,

    "semanticSnapshot": { "enabled": true, "tokenBudget": 8000 },
    "categories": {
      "identity": true, "config": true, "memory": true,
      "chat": true, "workspace": true, "database": true
    },

    "carrier": {
      "enabled": false,
      "workDir": "/tmp/coc-resurrections",
      "pollIntervalMs": 60000
    }
  }
}
```

Keep the private key in a read-only file (`chmod 600`).

## CLI quickstart

```bash
# First-time: register soul + run a full backup
coc-soul backup init

# Current state (chain registration / last backup / IPFS reachability)
coc-soul backup status

# Environment diagnostics with actionable recommendations
coc-soul backup doctor

# Incremental backup
coc-soul backup create

# List history
coc-soul backup list
```

## CLI reference

Five top-level subcommand groups.

### `coc-soul backup …` — soul backup / restore / inspection

| | |
|---|---|
| `init` | Register + run first full backup + write latest-recovery.json |
| `register` | Register only (no backup) |
| `create` | Run backup (incremental; `--full` forces full) |
| `list` / `history` | List local archives |
| `status` | Config + on-chain registration state |
| `doctor` | Environment diagnostics (IPFS / dataDir / recovery material) |
| `restore` | Restore from a manifestCid or the latest snapshot |
| `find-recoverable` | Scan for recoverable agents |
| `prune` | Delete old archives |
| `configure` | Adjust backup config |
| `configure-resurrection` | Set resurrection public key + offline timeout |
| `heartbeat` | Send heartbeat (prevents accidental resurrection) |
| `start` / `stop` | Auto-backup daemon |

### `coc-soul did …` — DID identity and delegation

| | |
|---|---|
| `add-key` / `revoke-key` | Manage verification methods |
| `keys --agent-id <id>` | List active verification methods |
| `update-doc` | Update DID document CID |
| `delegate` | Grant a delegation (`--depth 0` = leaf, cannot re-delegate) |
| `delegations --agent-id <id>` | List delegations |
| `revoke-delegation` / `revoke-all-delegations` | Revoke |
| `anchor-credential` / `revoke-credential` | Verifiable credential anchoring |
| `record-lineage` | Record agent fork relationship |
| `update-capabilities` | Update capability bitmap |
| `create-ephemeral` / `deactivate-ephemeral` | Short-lived sub-identities |

### `coc-soul guardian …` — custody

| | |
|---|---|
| `add` / `remove` | Manage guardian set |
| `list --agent-id <id>` | List current guardians (ACTIVE / INACTIVE) |
| `initiate` / `approve` / `status` | Resurrection request flow |

### `coc-soul recovery …` — social recovery (owner migration)

| | |
|---|---|
| `initiate` | Guardian initiates; specifies new owner address |
| `approve` | Other guardians approve |
| `complete` | Execute after quorum + timelock satisfied |
| `cancel` | Owner cancels a pending request |
| `status` | Query request state |

### `coc-soul carrier …` — hosting nodes

| | |
|---|---|
| `register` / `deregister` | On-chain registration |
| `availability` | Toggle available flag |
| `info --carrier-id <id>` | Read on-chain record |
| `list` | Scan CarrierRegistered events (auto-chunked by 10000 blocks) |
| `submit-request` | Hand a resurrection request to the local daemon |
| `start` / `stop` / `status` | Daemon lifecycle |

Every subcommand has `-h` / `--help` with full option details.

## Programmatic API

### Read on-chain state

```ts
import { SoulClient, DIDClient } from "@chainofclaw/soul";

const soul = new SoulClient(rpcUrl, soulRegistryAddress, privateKey);
const info = await soul.getSoul(agentId);
console.log("registered:", info.registered, "owner:", info.owner);

const did = new DIDClient(rpcUrl, didRegistryAddress, privateKey);
const keys = await did.listKeys(agentId);
const delegations = await did.listDelegations(agentId);
```

### Run a backup

```ts
import { BackupManager, BackupConfigSchema } from "@chainofclaw/soul";

const config = BackupConfigSchema.parse({
  rpcUrl: "...", ipfsUrl: "...", privateKey: "0x...",
  contractAddress: "0x...", didRegistryAddress: "0x...",
  sourceDir: "/home/you/.openclaw",
});

const backupManager = new BackupManager({
  config,
  archiveStore: yourArchiveStore,   // see below
  logger: console,
});

await backupManager.runBackup(/* full= */ false);
```

`archiveStore` is a `BackupArchiveRepository` port you provide — it persists `BackupArchive` records. The `coc-soul` bin uses an in-memory implementation (dropped at process exit); `@chainofclaw/claw-mem` injects a SQLite-backed one. Interface:

```ts
interface BackupArchiveRepository {
  insert(input: BackupArchiveInput): BackupArchive;
  getByCid(cid: string): BackupArchive | null;
  listByAgent(agentId: string, limit?: number): BackupArchive[];
  listAll(limit?: number): BackupArchive[];
  getLatestByAgent(agentId: string): BackupArchive | null;
  countIncrementalChain(): number;
  prune(opts: BackupArchivePruneOptions): BackupArchivePruneResult;
}
```

### Recovery / Carrier

```ts
import { RecoveryManager, CarrierManager } from "@chainofclaw/soul";

const recovery = new RecoveryManager({ backupManager, logger });
const carrier = new CarrierManager({ config: backupConfig, backupManager, logger });
```

## Standalone-bin limitations

`coc-soul` run standalone does **not persist** the backup archive table (it is in-process memory), so:
- It is suitable for one-shot DID / guardian / recovery / carrier commands.
- It is **not** suitable as a long-running `backup start` auto-backup daemon. Use `@chainofclaw/claw-mem` for that.

## Troubleshooting

**`backup status` shows "IPFS unreachable"**: check `ipfsUrl` (default `http://127.0.0.1:5001`). Without IPFS, backup/restore fail but read-only queries still work.

**`carrier list` prints `eth_getLogs block range too large`**: fixed in 1.0.8 (auto-chunked by 10000 blocks); upgrade.

**`did delegate` default `--depth`**: `0` means leaf delegation (cannot re-delegate); explicitly pass `--depth 1+` to allow further re-delegation.

**Private key safety**: for production prefer a hardware signer / cloud KMS instead of `backup.privateKey`. Only use plaintext keys on testnets for now.

## License

MIT
