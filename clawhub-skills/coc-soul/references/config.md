# `backup.*` + `carrier.*` config schema

Read from `~/.chainofclaw/config.json` (or `$COC_SOUL_CONFIG`). The skill looks at the `backup` key; carrier config lives nested under `backup.carrier`.

```json
{
  "backup": {
    "enabled": true,
    "sourceDir": "~/.openclaw",
    "rpcUrl": "http://localhost:18780",
    "ipfsUrl": "http://localhost:5001",
    "contractAddress": "0x...SoulRegistry...",
    "didRegistryAddress": "0x...DIDRegistry...",
    "rpcAuthToken": "optional-for-gated-rpcs",
    "privateKey": "0x...",
    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,
    "maxIncrementalChain": 10,
    "encryptMemory": false,
    "encryptionPassword": "...",
    "backupOnSessionEnd": true,
    "semanticSnapshot": {
      "enabled": true,
      "tokenBudget": 8000,
      "maxObservations": 50,
      "maxSummaries": 10
    },
    "categories": {
      "identity": true,
      "config": true,
      "memory": true,
      "chat": true,
      "workspace": true,
      "database": true
    },
    "carrier": {
      "enabled": false,
      "carrierId": "0x...",
      "agentEntryScript": "/path/to/agent-boot.sh",
      "workDir": "/tmp/coc-resurrections",
      "watchedAgents": [],
      "pollIntervalMs": 60000,
      "readinessTimeoutMs": 86400000,
      "readinessPollMs": 30000
    }
  }
}
```

## Critical fields

| Field | Required? | Notes |
|---|---|---|
| `rpcUrl` | yes | Must reach a COC node (local or public testnet) |
| `contractAddress` | yes for write | SoulRegistry deployment address |
| `didRegistryAddress` | yes for DID ops | |
| `ipfsUrl` | yes for backup | Default `http://127.0.0.1:5001` (local Kubo) |
| `privateKey` | yes for write | Use `chmod 600` on the config file |

## Key handling

For testnet the anvil default key works fine. For mainnet:

- Do **not** commit this file to git
- Prefer hardware signer or cloud KMS (not currently supported by the CLI — in roadmap)
- Keep the file mode `600`

## Backup chain limit

`maxIncrementalChain: 10` means after 10 incremental backups, the next one is forced to full. This bounds restore time.
