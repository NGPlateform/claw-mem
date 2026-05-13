// Deployed-contracts manifests for known COC networks.
//
// Each manifest pins the deployer + per-chain contract addresses for a
// known COC deployment. Resolved at runtime by chainId — callers should
// prefer this over hardcoded addresses so a single soul client can target
// multiple networks without rebuilding.
//
// Adding a new network: drop a `deployed-contracts-<chainId>.json` next to
// this file (matching DeployedManifest shape) and register it in MANIFESTS.

import manifest18780 from "./deployed-contracts-18780.json" with { type: "json" }
import manifest88780 from "./deployed-contracts-88780.json" with { type: "json" }

export interface DeployedManifest {
  /** Human-readable network label, e.g. "coc" or "coc-prowl". */
  network: string
  chainId: number
  /** EOA that deployed the contracts on this network. */
  deployer: string
  deployedAt: string
  /** True if the network is end-of-life; clients may warn but not refuse. */
  deprecated?: boolean
  deprecatedAt?: string
  deprecationNote?: string
  /** Contract name → checksum address. */
  contracts: Record<string, string>
}

const MANIFESTS: Record<number, DeployedManifest> = {
  18780: manifest18780 as DeployedManifest,
  88780: manifest88780 as DeployedManifest,
}

/**
 * Default chainId resolved when callers omit one. Tracks the currently
 * active COC testnet — bumped per release as networks migrate.
 */
export const DEFAULT_CHAIN_ID = 88780

export const SUPPORTED_CHAIN_IDS: readonly number[] = Object.freeze(
  Object.keys(MANIFESTS).map(Number)
)

/**
 * Look up a deployed-contracts manifest by chainId. Throws if the chainId
 * is unknown — callers should validate upstream and surface a clearer
 * error to the user. A `deprecated: true` manifest is still returned
 * (with the flag) so historical/archive access continues to work.
 */
export function getDeployedContracts(chainId: number): DeployedManifest {
  const manifest = MANIFESTS[chainId]
  if (!manifest) {
    throw new Error(
      `No deployed-contracts manifest for chainId=${chainId}. ` +
      `Supported: ${SUPPORTED_CHAIN_IDS.join(", ")}. ` +
      `Override the contract address explicitly if targeting a custom deployment.`
    )
  }
  return manifest
}

/**
 * Convenience accessor — read a single contract address by name.
 * Throws if the contract is not present in the manifest for `chainId`.
 */
export function getContractAddress(chainId: number, name: string): string {
  const manifest = getDeployedContracts(chainId)
  const address = manifest.contracts[name]
  if (!address) {
    throw new Error(
      `Contract "${name}" not deployed on chainId=${chainId}. ` +
      `Available: ${Object.keys(manifest.contracts).join(", ")}`
    )
  }
  return address
}
