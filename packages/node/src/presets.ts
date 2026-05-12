// Network and node-type presets for COC blockchain nodes.
// Migrated from COC/extensions/coc-nodeops/src/{network-presets,node-types}.ts.
//
// As of @chainofclaw/node v2, the canonical testnet is COC R3.2 (chainId
// 88780); the legacy prowl-testnet (chainId 18780) was decommissioned
// 2026-05-12 but is retained here as `prowl-testnet` for archival reads
// and historical replay.

// ──────────────────────────────────────────────────────────────────────────
// Network presets
// ──────────────────────────────────────────────────────────────────────────

export type NetworkId = "testnet" | "prowl-testnet" | "mainnet" | "local" | "custom"

export interface NetworkPreset {
  chainId: number
  bootstrapPeers: Array<{ id: string; url: string }>
  dhtBootstrapPeers: Array<{ id: string; address: string; port: number }>
  validators: string[]
  /**
   * Genesis prefund — must match the upstream chain's genesis stateRoot.
   * Without this a fullnode joining an existing network fails block signature
   * verification after snap sync, because its initial state diverges.
   */
  prefund?: Array<{ address: string; balanceEth: string }>
  /** Optional validator stakes (matches ValidatorRegistry seed). */
  validatorStakes?: Array<{ id: string; address: string; stake: string }>
  rpcPort: number
  p2pPort: number
  wirePort: number
  wsPort: number
  ipfsPort: number
  /** True when the network is end-of-life — clients may warn but not refuse. */
  deprecated?: boolean
  deprecationNote?: string
}

export const NETWORK_PRESETS: Record<Exclude<NetworkId, "custom">, NetworkPreset> = {
  // COC R3.2 prod-candidate testnet (chainId 88780). 5 validators + 2 observers
  // across multiple hosts; public bootstrap peers are deployment-specific and
  // are NOT pinned in the preset — pass `bootstrapPeers` explicitly via the
  // node CLI (`--peer <id>@<url>`) or `peers` in your node config.
  testnet: {
    chainId: 88780,
    bootstrapPeers: [],
    dhtBootstrapPeers: [],
    validators: [
      "0xde4e7889aa9007318ff261b1ee675f1305153590",
      "0xb939e5a68abd2e000e78876bd86edd1cbba49eb9",
      "0xdefc8430388093fdfacb0a929fedc14d2e631d19",
      "0xcc64096600c1759d7aaea91166837a5873175867",
      "0x5e773c9359a6bb416bdfffe0c9aac9f568bd11ae",
    ],
    validatorStakes: [
      { id: "0xde4e7889aa9007318ff261b1ee675f1305153590", address: "0xde4e7889aa9007318ff261b1ee675f1305153590", stake: "32000000000000000000" },
      { id: "0xb939e5a68abd2e000e78876bd86edd1cbba49eb9", address: "0xb939e5a68abd2e000e78876bd86edd1cbba49eb9", stake: "32000000000000000000" },
      { id: "0xdefc8430388093fdfacb0a929fedc14d2e631d19", address: "0xdefc8430388093fdfacb0a929fedc14d2e631d19", stake: "32000000000000000000" },
      { id: "0xcc64096600c1759d7aaea91166837a5873175867", address: "0xcc64096600c1759d7aaea91166837a5873175867", stake: "32000000000000000000" },
      { id: "0x5e773c9359a6bb416bdfffe0c9aac9f568bd11ae", address: "0x5e773c9359a6bb416bdfffe0c9aac9f568bd11ae", stake: "32000000000000000000" },
    ],
    prefund: [
      { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", balanceEth: "10000000" },
      { address: "0xde4e7889aa9007318ff261b1ee675f1305153590", balanceEth: "100" },
      { address: "0xb939e5a68abd2e000e78876bd86edd1cbba49eb9", balanceEth: "100" },
      { address: "0xdefc8430388093fdfacb0a929fedc14d2e631d19", balanceEth: "100" },
      { address: "0xcc64096600c1759d7aaea91166837a5873175867", balanceEth: "100" },
      { address: "0x5e773c9359a6bb416bdfffe0c9aac9f568bd11ae", balanceEth: "100" },
    ],
    rpcPort: 28780,
    p2pPort: 29780,
    wirePort: 29781,
    wsPort: 28790,
    ipfsPort: 28800,
  },
  // Legacy COC prowl-testnet (chainId 18780). Decommissioned 2026-05-12; data
  // dirs on operator-1/2/3 have been wiped. Retained for archival snapshots
  // and historical state replay only — live RPC may not respond.
  "prowl-testnet": {
    chainId: 18780,
    bootstrapPeers: [
      { id: "coc-sync-node", url: "http://199.192.16.79:19880" },
      { id: "coc-node-1", url: "http://199.192.16.79:29780" },
      { id: "coc-node-2", url: "http://199.192.16.79:29782" },
      { id: "coc-node-3", url: "http://199.192.16.79:29784" },
    ],
    dhtBootstrapPeers: [
      { id: "coc-sync-node", address: "199.192.16.79", port: 19881 },
      { id: "coc-node-1", address: "199.192.16.79", port: 29781 },
      { id: "coc-node-2", address: "199.192.16.79", port: 29783 },
      { id: "coc-node-3", address: "199.192.16.79", port: 29785 },
    ],
    validators: [
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    ],
    prefund: [
      { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", balanceEth: "10000" },
      { address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", balanceEth: "10000" },
      { address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", balanceEth: "1000" },
      { address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", balanceEth: "1000" },
      { address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", balanceEth: "1000" },
    ],
    rpcPort: 18780,
    p2pPort: 19780,
    wirePort: 19781,
    wsPort: 18781,
    ipfsPort: 5001,
    deprecated: true,
    deprecationNote: "chainId 18780 (prowl-testnet) decommissioned 2026-05-12 — replaced by chainId 88780 (R3.2). Live RPC may not respond; preset retained for historical replay only.",
  },
  mainnet: {
    chainId: 1,
    bootstrapPeers: [],
    dhtBootstrapPeers: [],
    validators: [],
    rpcPort: 28780,
    p2pPort: 29780,
    wirePort: 29781,
    wsPort: 28790,
    ipfsPort: 28800,
  },
  local: {
    chainId: 88780,
    bootstrapPeers: [],
    dhtBootstrapPeers: [],
    validators: ["node-1"],
    rpcPort: 28780,
    p2pPort: 29780,
    wirePort: 29781,
    wsPort: 28790,
    ipfsPort: 28800,
  },
}

export const NETWORK_LABELS: Record<NetworkId, string> = {
  testnet: "Testnet R3.2 (chainId 88780 — current public test network)",
  "prowl-testnet": "Prowl testnet (chainId 18780 — DECOMMISSIONED, archive only)",
  mainnet: "Mainnet (not yet launched)",
  local: "Local (localhost, auto ports)",
  custom: "Custom (specify all parameters)",
}

export function isValidNetworkId(value: string): value is NetworkId {
  return (
    value === "testnet" ||
    value === "prowl-testnet" ||
    value === "mainnet" ||
    value === "local" ||
    value === "custom"
  )
}

export function getNetworkPreset(id: Exclude<NetworkId, "custom">): NetworkPreset {
  return NETWORK_PRESETS[id]
}

// ──────────────────────────────────────────────────────────────────────────
// Node type presets
// ──────────────────────────────────────────────────────────────────────────

export type NodeType = "validator" | "fullnode" | "archive" | "gateway" | "dev"

export interface NodeTypePreset {
  description: string
  configOverrides: Record<string, unknown>
  services: ("node" | "agent" | "relayer")[]
}

export const NODE_TYPE_PRESETS: Record<NodeType, NodeTypePreset> = {
  validator: {
    description: "Validator node - participates in BFT consensus and block production",
    configOverrides: {
      enableBft: true,
      enableWireProtocol: true,
      enableDht: true,
      enableSnapSync: true,
      storage: { backend: "leveldb" },
      p2pInboundAuthMode: "enforce",
    },
    services: ["node", "agent"],
  },
  fullnode: {
    description: "Full node - syncs all blocks, provides RPC, no block production",
    configOverrides: {
      enableBft: false,
      enableWireProtocol: true,
      enableDht: true,
      enableSnapSync: true,
      storage: { backend: "leveldb" },
      validators: [],
      p2pInboundAuthMode: "enforce",
      // Observer nodes should warn rather than reject when block signature
      // checks fail — validators may use a signing scheme the observer cannot
      // verify (e.g. ephemeral keys not in validators[]). In "enforce" mode
      // the first mismatch stalls sync permanently.
      signatureEnforcement: "monitor",
    },
    services: ["node"],
  },
  archive: {
    description: "Archive node - full history, pruning disabled",
    configOverrides: {
      enableBft: false,
      enableWireProtocol: true,
      enableDht: true,
      enableSnapSync: true,
      storage: { backend: "leveldb", enablePruning: false },
      validators: [],
      p2pInboundAuthMode: "enforce",
    },
    services: ["node"],
  },
  gateway: {
    description: "Gateway node - lightweight RPC proxy, in-memory storage",
    configOverrides: {
      enableBft: false,
      enableWireProtocol: false,
      enableDht: false,
      enableSnapSync: false,
      storage: { backend: "memory" },
      validators: [],
      p2pInboundAuthMode: "off",
    },
    services: ["node"],
  },
  dev: {
    description: "Dev node - local development with test accounts, single-node",
    configOverrides: {
      enableBft: false,
      enableWireProtocol: false,
      enableDht: false,
      enableSnapSync: false,
      storage: { backend: "leveldb" },
      validators: ["dev-node"],
      p2pInboundAuthMode: "off",
      prefund: [
        { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", balanceEth: "10000" },
        { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", balanceEth: "10000" },
        { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", balanceEth: "10000" },
      ],
    },
    services: ["node"],
  },
} as const

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  validator: "Validator (BFT consensus, block production)",
  fullnode: "Full Node (sync + RPC, no production)",
  archive: "Archive (full history, no pruning)",
  gateway: "Gateway (lightweight RPC proxy)",
  dev: "Dev (local development, test accounts)",
}

export function isValidNodeType(value: string): value is NodeType {
  return value in NODE_TYPE_PRESETS
}
