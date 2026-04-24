# Carrier operations

A **carrier** is a hosting node that can adopt and run an offline agent's soul. Carriers are discovered on-chain through `CarrierRegistered` events.

## Registration

| Command | Effect |
|---|---|
| `carrier register --carrier-id <id> --endpoint https://… --cpu-millicores 1000 --memory-mb 2048 --storage-mb 10240` | Publish availability on-chain |
| `carrier deregister --carrier-id <id>` | Remove |
| `carrier availability --carrier-id <id> --available <true\|false>` | Flip the available flag without deregistering |

## Discovery

- `carrier list` — scan `CarrierRegistered` / `CarrierDeregistered` events (auto-chunked by 10000 blocks since 1.0.8)
- `carrier info --carrier-id <id>` — fetch full record for a specific carrier

## Daemon

The carrier daemon watches its inbox of pending resurrection requests and orchestrates the agent spawn.

| Command | Effect |
|---|---|
| `carrier start` | Start the daemon (requires `backup.carrier.enabled: true` in config) |
| `carrier stop` | Graceful shutdown |
| `carrier status` | Is the daemon enabled + running? |
| `carrier submit-request --request-id <id>` | Hand a specific pending request to the local daemon |

## Resurrection inside the daemon

For each pending request the daemon:

1. Verifies the carrier has been explicitly confirmed by guardians
2. Downloads the agent's latest soul backup from IPFS
3. Decrypts with the resurrection key (provided by the initiating guardian)
4. Spawns the agent using `carrier.agentEntryScript` in `carrier.workDir`
5. Reports back on-chain that the agent is alive

## Configuration

See `backup.carrier.*` in the soul config schema. Critical knobs:

- `enabled` (default `false`) — safety gate
- `carrierId` — your on-chain carrier ID
- `agentEntryScript` — path to the script that boots an agent from unpacked state
- `workDir` (default `/tmp/coc-resurrections`) — staging area
- `pollIntervalMs` (default 60000)
- `readinessTimeoutMs` (default 86400000 = 24h)
