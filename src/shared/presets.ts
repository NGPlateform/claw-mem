// Network and node-type presets for COC blockchain nodes.
// Migrated from COC/extensions/coc-nodeops/src/{network-presets,node-types}.ts.

// ──────────────────────────────────────────────────────────────────────────
// Network presets
// ──────────────────────────────────────────────────────────────────────────

export type NetworkId = "testnet" | "mainnet" | "local" | "custom"

export interface NetworkPreset {
  chainId: number
  bootstrapPeers: Array<{ id: string; url: string }>
  dhtBootstrapPeers: Array<{ id: string; address: string; port: number }>
  validators: string[]
  // Genesis prefund — required to match the upstream chain's genesis stateRoot.
  // Without this, a fullnode joining an existing network fails block signature
  // verification after snap sync, because its initial state diverges.
  prefund?: Array<{ address: string; balanceEth: string }>
  rpcPort: number
  p2pPort: number
  wirePort: number
  wsPort: number
  ipfsPort: number
}

export const NETWORK_PRESETS: Record<Exclude<NetworkId, "custom">, NetworkPreset> = {
  // Live testnet at server1.clawchain.io (199.192.16.79). The node cluster
  // runs under docker, so external ports are remapped: the coc-sync-node
  // container's internal 19780/19781 are reachable on 19880/19881, and each
  // coc-node-{1,2,3} occupies 29780-29785 on the host.
  testnet: {
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
    ],
    rpcPort: 18780,
    p2pPort: 19780,
    wirePort: 19781,
    wsPort: 18781,
    ipfsPort: 5001,
  },
  mainnet: {
    chainId: 1,
    bootstrapPeers: [],
    dhtBootstrapPeers: [],
    validators: [],
    rpcPort: 18780,
    p2pPort: 19780,
    wirePort: 19781,
    wsPort: 18781,
    ipfsPort: 5001,
  },
  local: {
    chainId: 18780,
    bootstrapPeers: [],
    dhtBootstrapPeers: [],
    validators: ["node-1"],
    rpcPort: 18780,
    p2pPort: 19780,
    wirePort: 19781,
    wsPort: 18781,
    ipfsPort: 5001,
  },
}

export const NETWORK_LABELS: Record<NetworkId, string> = {
  testnet: "Testnet (public test network)",
  mainnet: "Mainnet (not yet launched)",
  local: "Local (localhost, auto ports)",
  custom: "Custom (specify all parameters)",
}

export function isValidNetworkId(value: string): value is NetworkId {
  return value === "testnet" || value === "mainnet" || value === "local" || value === "custom"
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
