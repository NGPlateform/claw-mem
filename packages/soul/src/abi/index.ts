// COC contract ABIs, packaged for downstream tooling.
//
// Sourced from the COC repo's compiled Hardhat artifacts and pinned per
// release. Use these when you need to attach an ethers Contract to a
// non-default address (e.g. a custom local devnet) or decode logs from
// raw RPC responses without rebuilding the ABI yourself.
//
// The clients shipped in this package (SoulClient / DIDClient /
// ValidatorMonitor) already bundle the subset of the ABI they need; you
// only need to import from here for direct contract access.

import CidRegistryAbi from "./CidRegistry.json" with { type: "json" }
import DIDRegistryAbi from "./DIDRegistry.json" with { type: "json" }
import DelayedInboxAbi from "./DelayedInbox.json" with { type: "json" }
import EquivocationDetectorAbi from "./EquivocationDetector.json" with { type: "json" }
import FactionRegistryAbi from "./FactionRegistry.json" with { type: "json" }
import GovernanceDAOAbi from "./GovernanceDAO.json" with { type: "json" }
import InsuranceFundAbi from "./InsuranceFund.json" with { type: "json" }
import PoSeManagerAbi from "./PoSeManager.json" with { type: "json" }
import PoSeManagerV2Abi from "./PoSeManagerV2.json" with { type: "json" }
import RollupStateManagerAbi from "./RollupStateManager.json" with { type: "json" }
import SoulRegistryAbi from "./SoulRegistry.json" with { type: "json" }
import TreasuryAbi from "./Treasury.json" with { type: "json" }
import ValidatorRegistryAbi from "./ValidatorRegistry.json" with { type: "json" }

export {
  CidRegistryAbi,
  DIDRegistryAbi,
  DelayedInboxAbi,
  EquivocationDetectorAbi,
  FactionRegistryAbi,
  GovernanceDAOAbi,
  InsuranceFundAbi,
  PoSeManagerAbi,
  PoSeManagerV2Abi,
  RollupStateManagerAbi,
  SoulRegistryAbi,
  TreasuryAbi,
  ValidatorRegistryAbi,
}

/** Map of contract name → ABI, indexed by the same keys used in the deployed-contracts manifests. */
export const CONTRACT_ABIS = {
  CidRegistry: CidRegistryAbi,
  DIDRegistry: DIDRegistryAbi,
  DelayedInbox: DelayedInboxAbi,
  EquivocationDetector: EquivocationDetectorAbi,
  FactionRegistry: FactionRegistryAbi,
  GovernanceDAO: GovernanceDAOAbi,
  InsuranceFund: InsuranceFundAbi,
  PoSeManager: PoSeManagerAbi,
  PoSeManagerV2: PoSeManagerV2Abi,
  RollupStateManager: RollupStateManagerAbi,
  SoulRegistry: SoulRegistryAbi,
  Treasury: TreasuryAbi,
  ValidatorRegistry: ValidatorRegistryAbi,
} as const

export type ContractName = keyof typeof CONTRACT_ABIS
