// ValidatorRegistry event monitor (ethers v6).
//
// Subscribes to the on-chain stake / slash lifecycle published by
// ValidatorRegistry on the active COC network. Surfaces strongly-typed
// callbacks so downstream services (slash dashboards, alerting, soul
// recovery flows) don't have to redo the ethers wiring.
//
// The slash flow on chainId 88780 splits the slashed stake across three
// destinations — burn / reporter / insurance fund — and emits
// `SlashDistributed` alongside the legacy `ValidatorSlashed`. Both are
// surfaced; subscribe to the one that matches your needs.

import { Contract, FetchRequest, JsonRpcProvider } from "ethers"
import { getContractAddress } from "./manifests/index.ts"

const VALIDATOR_REGISTRY_EVENT_ABI = [
  "event ValidatorRegistered(bytes32 indexed nodeId, address indexed operator, uint256 stake, bytes pubkeyNode)",
  "event ValidatorActivated(bytes32 indexed nodeId)",
  "event ValidatorDeactivated(bytes32 indexed nodeId, uint64 unstakeRequestedAt)",
  "event ValidatorWithdrew(bytes32 indexed nodeId, address indexed operator, uint256 amount)",
  "event ValidatorSlashed(bytes32 indexed nodeId, uint256 amount, bytes32 indexed reason)",
  "event SlashDistributed(bytes32 indexed nodeId, uint256 burnAmount, uint256 reporterAmount, uint256 insuranceAmount)",
  // Read helpers consumed by status queries
  "function getActiveValidators() external view returns (bytes32[])",
  "function isActive(bytes32 nodeId) external view returns (bool)",
  "function activeValidatorCount() external view returns (uint256)",
] as const

export interface ValidatorRegisteredEvent {
  nodeId: string
  operator: string
  stake: bigint
  pubkeyNode: string
  blockNumber: number
  txHash: string
}

export interface ValidatorSlashedEvent {
  nodeId: string
  amount: bigint
  reason: string
  blockNumber: number
  txHash: string
}

export interface SlashDistributedEvent {
  nodeId: string
  burnAmount: bigint
  reporterAmount: bigint
  insuranceAmount: bigint
  blockNumber: number
  txHash: string
}

export interface ValidatorActivatedEvent {
  nodeId: string
  blockNumber: number
  txHash: string
}

export interface ValidatorDeactivatedEvent {
  nodeId: string
  unstakeRequestedAt: bigint
  blockNumber: number
  txHash: string
}

export interface ValidatorMonitorHandlers {
  onRegistered?: (event: ValidatorRegisteredEvent) => void | Promise<void>
  onActivated?: (event: ValidatorActivatedEvent) => void | Promise<void>
  onDeactivated?: (event: ValidatorDeactivatedEvent) => void | Promise<void>
  onSlashed?: (event: ValidatorSlashedEvent) => void | Promise<void>
  onSlashDistributed?: (event: SlashDistributedEvent) => void | Promise<void>
}

export interface ValidatorMonitorOptions {
  rpcUrl: string
  contractAddress: string
  rpcAuthToken?: string
}

/**
 * Subscribe to ValidatorRegistry events. Returns a `stop()` function that
 * removes all listeners (caller should call it on shutdown to avoid leaking
 * sockets / timers).
 */
export class ValidatorMonitor {
  private readonly provider: JsonRpcProvider
  private readonly contract: Contract

  constructor(opts: ValidatorMonitorOptions) {
    if (opts.rpcAuthToken) {
      const fetchReq = new FetchRequest(opts.rpcUrl)
      fetchReq.setHeader("Authorization", `Bearer ${opts.rpcAuthToken}`)
      this.provider = new JsonRpcProvider(fetchReq)
    } else {
      this.provider = new JsonRpcProvider(opts.rpcUrl)
    }
    this.contract = new Contract(opts.contractAddress, VALIDATOR_REGISTRY_EVENT_ABI, this.provider)
  }

  /**
   * Resolve the ValidatorRegistry address for `chainId` from the packaged
   * manifest. Returns a ready-to-use monitor.
   */
  static fromChainId(
    chainId: number,
    rpcUrl: string,
    opts: { rpcAuthToken?: string; contractAddress?: string } = {},
  ): ValidatorMonitor {
    const address = opts.contractAddress ?? getContractAddress(chainId, "ValidatorRegistry")
    return new ValidatorMonitor({ rpcUrl, contractAddress: address, rpcAuthToken: opts.rpcAuthToken })
  }

  /**
   * Attach all configured handlers. Returns a stop function that detaches
   * everything.
   */
  start(handlers: ValidatorMonitorHandlers): () => void {
    const wrappers: Array<{ event: string; handler: (...args: unknown[]) => void }> = []

    if (handlers.onRegistered) {
      const fn = (nodeId: string, operator: string, stake: bigint, pubkeyNode: string, ev: { log: { blockNumber: number; transactionHash: string } }) =>
        handlers.onRegistered!({ nodeId, operator, stake, pubkeyNode, blockNumber: ev.log.blockNumber, txHash: ev.log.transactionHash })
      this.contract.on("ValidatorRegistered", fn as never)
      wrappers.push({ event: "ValidatorRegistered", handler: fn as never })
    }
    if (handlers.onActivated) {
      const fn = (nodeId: string, ev: { log: { blockNumber: number; transactionHash: string } }) =>
        handlers.onActivated!({ nodeId, blockNumber: ev.log.blockNumber, txHash: ev.log.transactionHash })
      this.contract.on("ValidatorActivated", fn as never)
      wrappers.push({ event: "ValidatorActivated", handler: fn as never })
    }
    if (handlers.onDeactivated) {
      const fn = (nodeId: string, unstakeRequestedAt: bigint, ev: { log: { blockNumber: number; transactionHash: string } }) =>
        handlers.onDeactivated!({ nodeId, unstakeRequestedAt, blockNumber: ev.log.blockNumber, txHash: ev.log.transactionHash })
      this.contract.on("ValidatorDeactivated", fn as never)
      wrappers.push({ event: "ValidatorDeactivated", handler: fn as never })
    }
    if (handlers.onSlashed) {
      const fn = (nodeId: string, amount: bigint, reason: string, ev: { log: { blockNumber: number; transactionHash: string } }) =>
        handlers.onSlashed!({ nodeId, amount, reason, blockNumber: ev.log.blockNumber, txHash: ev.log.transactionHash })
      this.contract.on("ValidatorSlashed", fn as never)
      wrappers.push({ event: "ValidatorSlashed", handler: fn as never })
    }
    if (handlers.onSlashDistributed) {
      const fn = (nodeId: string, burnAmount: bigint, reporterAmount: bigint, insuranceAmount: bigint, ev: { log: { blockNumber: number; transactionHash: string } }) =>
        handlers.onSlashDistributed!({ nodeId, burnAmount, reporterAmount, insuranceAmount, blockNumber: ev.log.blockNumber, txHash: ev.log.transactionHash })
      this.contract.on("SlashDistributed", fn as never)
      wrappers.push({ event: "SlashDistributed", handler: fn as never })
    }

    return () => {
      for (const { event, handler } of wrappers) {
        this.contract.off(event, handler as never)
      }
    }
  }

  async getActiveValidators(): Promise<string[]> {
    return this.contract.getActiveValidators()
  }

  async isActive(nodeId: string): Promise<boolean> {
    return this.contract.isActive(nodeId)
  }

  async activeValidatorCount(): Promise<bigint> {
    return this.contract.activeValidatorCount()
  }
}
