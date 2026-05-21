# Migration Guide — @chainofclaw v2 / claw-mem v3

## v2.1 / v3.1 — independent on-chain witness quorum verification (#667)

`@chainofclaw/soul@2.1.0` + `@chainofclaw/claw-mem@3.1.0` ship the new
`submitBatchV2WithMetadata` contract surface (COC PR #710 + #713). This is
**additive** — every v2.0 / v3.0 API still works unchanged.

What's new:

- The packaged `PoSeManagerV2.json` ABI now includes `submitBatchV2WithMetadata`
  + the `ReceiptBatchMetadataSubmitted` event and the new errors
  (`WitnessNotActive`, `WitnessSigReplay`, `MerkleRootMismatch`,
  `MetadataLengthMismatch`, `BadReceiptIndex`).
- The `WitnessAttestationV2` typehash (`bytes32 challengeId, bytes32 nodeId,
  bytes32 responseBodyHash, uint8 witnessIndex, uint64 epochId`) — binds a
  witness signature to the epoch in which it was collected.

This is an additive ABI bump (no struct removed, no method removed), so any
caller that decoded the v2.0 ABI continues to decode correctly. To use the
new path:

```ts
import { CONTRACT_ABIS } from "@chainofclaw/soul"
import { ethers } from "ethers"

const pose = new ethers.Contract(addr, CONTRACT_ABIS.PoSeManagerV2, signer)
await pose.submitBatchV2WithMetadata(
  epochId,
  merkleRoot,
  summaryHash,
  sampleProofs,
  witnessBitmap,
  witnessSignatures,
  {
    challengeIds,
    nodeIds,
    responseBodyHashes,
    leafHashes,
    witnessReceiptIndex,  // uint16[32], unused slots = 0xffff
  },
)
```

If you only consume `BatchSubmittedV2` events: no change. If you also want
to index per-receipt metadata, subscribe to `ReceiptBatchMetadataSubmitted`
emitted by the same tx.

Live 88780 deployments will keep accepting the legacy `submitBatchV2`
during the rollout window (PR-D upgrade); the v1 typehash sunset is
COC PR-E (~30 days after PR-D).

---


This release tracks the **COC R3.2 (chainId 88780) production-candidate testnet**
that came online on 2026-05-11 and replaces the now-decommissioned prowl-testnet
(chainId 18780, retired 2026-05-12). Every package in the monorepo bumps a
major version because the default chainId, contract addresses, default RPC
host, and the public client surface all change.

| Package | v1 → v2/v3 |
|---|---|
| `@chainofclaw/node` | 1.2.1 → **2.0.0** |
| `@chainofclaw/soul` | 1.2.10 → **2.0.0** |
| `@chainofclaw/claw-mem` | 2.3.1 → **3.0.0** |

## TL;DR

```bash
# Upgrade
npm install @chainofclaw/claw-mem@^3

# If you were on the prowl-testnet (18780) and want archival-only reads, set:
#   backup.chainId = 18780
# Otherwise the package now defaults to chainId 88780 with the matching
# contract addresses bundled in.
```

## Headline changes

### 1. Default chainId is now 88780 (was 18780)

`@chainofclaw/soul` and `@chainofclaw/claw-mem` now ship with a packaged
deployed-contracts manifest for **chainId 88780** at
`packages/soul/src/manifests/deployed-contracts-88780.json`, and resolve
SoulRegistry / DIDRegistry / ValidatorRegistry / PoSeManagerV2 / ... addresses
from that manifest automatically.

The previous prowl-testnet manifest (chainId 18780) is retained as
`deployed-contracts-18780.json` with `deprecated: true` so archival readers
still work; pass `backup.chainId = 18780` to opt in.

### 2. SoulRegistry / DIDRegistry default addresses changed

If you were relying on the **previous hardcoded defaults**, they were
already stale by v1.2.10 — the soul registry on the old single-host docker
deploy (`0x1291Be112d480055DaFd8a610b7d1e203891C274`) had been replaced
twice before being retired. v2 drops all hardcoded address defaults and
resolves them from the manifest at runtime instead.

If you need to point at a custom deployment (your own devnet, a forked
testnet, an air-gapped lab), pass the address explicitly:

```ts
import { SoulClient } from "@chainofclaw/soul"

// Old (v1): always required an explicit address
const client = new SoulClient(rpcUrl, "0xabc...", privateKey)

// New (v2): same constructor still works, OR resolve from chainId:
const client = SoulClient.fromChainId(88780, rpcUrl, privateKey)

// Override the manifest address while keeping chainId-based resolution
// for everything else (e.g. DID, validators):
const client = SoulClient.fromChainId(88780, rpcUrl, privateKey, {
  contractAddress: "0xMyCustomSoulRegistry...",
})
```

### 3. New DIDRegistry ABI exposed

The DIDRegistry contract was deployed for the first time on chainId 88780.
`@chainofclaw/soul` v2 ships a high-level `DIDClient` that wraps every
`external` method:

```ts
import { DIDClient } from "@chainofclaw/soul"

const did = DIDClient.fromChainId(88780, rpcUrl, privateKey)

await did.updateDIDDocument(agentId, newDocumentCid)
await did.grantDelegation(delegator, delegatee, parentDelegation, scopeHash, expiresAt, depth)
await did.createEphemeralIdentity(parentAgentId, ephemeralId, ephemeralAddress, scopeHash, expiresAt)
await did.anchorCredential(credentialHash, issuerAgentId, subjectAgentId, credentialCid, expiresAt)
```

### 4. ValidatorRegistry stake / slash event stream

Slashing on chainId 88780 splits the slashed stake across **burn (50%) /
reporter (30%) / InsuranceFund (20%)** and emits a new `SlashDistributed`
event alongside the legacy `ValidatorSlashed`. v2 ships `ValidatorMonitor`
to subscribe to both:

```ts
import { ValidatorMonitor } from "@chainofclaw/soul"

const monitor = ValidatorMonitor.fromChainId(88780, rpcUrl)

const stop = monitor.start({
  onSlashed: ({ nodeId, amount, reason }) => log.warn("validator slashed", { nodeId, amount, reason }),
  onSlashDistributed: ({ nodeId, burnAmount, reporterAmount, insuranceAmount }) =>
    log.info("slash distributed", { nodeId, burnAmount, reporterAmount, insuranceAmount }),
})

// On shutdown:
stop()
```

### 5. Admin RPC bearer-token authentication

COC node v0.2+ gates `admin_*` RPC methods behind a two-layer check —
`enableAdminRpc=true` AND (a `Bearer <token>` header OR a loopback request).
v3 of `@chainofclaw/claw-mem` honours `backup.rpcAuthToken` (or
`COC_RPC_AUTH_TOKEN` environment variable) and attaches it on every
outbound RPC call from the bootstrap / status / lifecycle paths.

```bash
# Either: persist in config
claw-mem config set backup.rpcAuthToken "$YOUR_NODE_ADMIN_TOKEN"

# Or: pass per-invocation
COC_RPC_AUTH_TOKEN="$YOUR_NODE_ADMIN_TOKEN" claw-mem bootstrap prod
```

### 6. Default RPC / IPFS / faucet URLs are now local-first

| Default | v1 | v2/v3 |
|---|---|---|
| `backup.rpcUrl` | `http://199.192.16.79:28780` (prowl-testnet host) | `http://127.0.0.1:28780` |
| `backup.ipfsUrl` | `http://199.192.16.79:28786` | `http://127.0.0.1:5001` |
| `backup.faucetUrl` | `http://199.192.16.79:3003` | `""` (disabled) |

The intent is to make a fresh install work against a locally-running COC
node out of the box, and to never leak a specific hosted endpoint into a
default config. Set these explicitly in your config when targeting a
remote validator/observer.

### 7. Node networking presets — `testnet` now means 88780

`@chainofclaw/node` `NETWORK_PRESETS.testnet` is now chainId **88780**
(R3.2), with the validator set, prefund, and port layout from the R3.2
genesis. The legacy 18780 preset is preserved as `prowl-testnet`:

```ts
import { NETWORK_PRESETS, type NetworkId } from "@chainofclaw/node"

NETWORK_PRESETS.testnet.chainId       // 88780
NETWORK_PRESETS["prowl-testnet"].chainId // 18780 (deprecated)
NETWORK_PRESETS["prowl-testnet"].deprecated // true
```

If you persisted `node.defaultNetwork: "testnet"` from a v1 install, no
config change is needed but the chain you connect to has changed — the
old endpoint will not respond.

### 8. New raw ABI exports

`@chainofclaw/soul` now exports the raw Hardhat ABIs of all 13 governance /
settlement contracts deployed on chainId 88780 for downstream tooling that
needs to attach ethers Contracts directly:

```ts
import { CONTRACT_ABIS, ValidatorRegistryAbi } from "@chainofclaw/soul"

// One-off:
const contract = new ethers.Contract(addr, ValidatorRegistryAbi, provider)

// Indexed:
const contract = new ethers.Contract(addr, CONTRACT_ABIS.ValidatorRegistry, provider)
```

The bundled clients (`SoulClient`, `DIDClient`, `ValidatorMonitor`) keep
their own minimal inline ABIs and don't depend on these exports — they're
here for advanced use cases only.

## What did NOT change

- The backup / recovery / carrier control flow is unchanged. Existing v1
  `BackupManager` / `RecoveryManager` / `CarrierManager` callers compile
  and run unmodified.
- claw-mem's persistent-memory layer (observations / summaries / search) is
  unchanged. SQLite schema, hook lifecycle, and the `mem-search` /
  `mem-status` / `mem-forget` tools all behave identically.
- The CLI surface (`claw-mem`, `coc-node`, `coc-soul` binaries) keeps the
  same subcommand layout. New flags / behaviour are additive.

## Rollback

If you need to roll back to v1.x:

```bash
npm install @chainofclaw/claw-mem@2.3.1 \
            @chainofclaw/node@1.2.1 \
            @chainofclaw/soul@1.2.10
```

…but the chain the v1 defaults point to (18780) is no longer running, so
expect RPC timeouts unless you point at a snapshot replay node.
