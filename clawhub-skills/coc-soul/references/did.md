# `coc-soul did` — DID identity management

Every subcommand takes on-chain state. Read operations are free; write operations cost gas.

## Read

| Command | What it returns |
|---|---|
| `keys --agent-id <id>` | Active verification methods (keys) and their purposes |
| `delegations --agent-id <id>` | All delegations granted by the agent, with scope + state |

## Key management (write)

- `add-key --agent-id <id> --key-hash <bytes32> --verification-address 0x… --purpose <n>` — register a new verification method
- `revoke-key --agent-id <id> --key-hash <bytes32>` — disable an existing method
- `update-doc --agent-id <id> --cid <ipfs-cid>` — point the DID document to a new IPFS CID

## Delegation

- `delegate --delegator <id> --delegatee <id> --scope <bytes32> --expires <unix> [--parent <id>] [--depth <0-3>]`
  - **depth 0** (default): leaf delegation — delegatee cannot re-delegate
  - **depth 1–3**: allow transitive re-delegation to that many layers
- `revoke-delegation --delegation-id <id>` — revoke one delegation
- `revoke-all-delegations --agent-id <id>` — emergency: revoke every delegation granted by the agent

## Credentials

- `anchor-credential --credential-hash <bytes32> --issuer <id> --subject <id> --credential-cid <bytes32> --expires <unix> --sig <bytes>` — anchor a verifiable credential on-chain
- `revoke-credential --credential-id <bytes32>` — revoke a previously anchored credential

## Ephemeral identities

- `create-ephemeral --parent <id> --ephemeral-id <id> --ephemeral-address 0x… --scope <hash> --expires <unix>` — spawn a short-lived sub-identity
- `deactivate-ephemeral --ephemeral-id <id>` — explicitly deactivate before expiry

## Lineage + capabilities

- `record-lineage --agent-id <id> --parent-agent-id <id> --fork-height <n> --generation <n>` — note that this agent was forked from a parent
- `update-capabilities --agent-id <id> --capabilities <bitmask>` — update the capability bitmask

## EIP-712 signing

Delegation and credential anchoring use EIP-712 structured signatures. The CLI constructs the typed-data domain automatically using the configured RPC + `didRegistryAddress`.
