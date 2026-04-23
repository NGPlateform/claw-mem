// `claw-mem bootstrap prod` — interactive wizard pointing at an existing
// (testnet/mainnet) chain. Validates inputs by hitting the RPC.

import * as p from "@clack/prompts"
import { JsonRpcProvider, Wallet, formatEther } from "ethers"

import type { CliServices } from "../register-all.ts"
import {
  DEFAULT_CONFIG_PATH,
  patchConfigFile,
  setDotPath,
} from "../../services/config-persistence.ts"

export interface ProdBootstrapOptions {
  nonInteractive?: boolean
  rpc?: string
  poseManager?: string
  soulRegistry?: string
  didRegistry?: string
  cidRegistry?: string
  privateKey?: string
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const KEY_RE = /^0x[0-9a-fA-F]{64}$/

export async function runProdBootstrap(services: CliServices, opts: ProdBootstrapOptions): Promise<void> {
  const noInput = opts.nonInteractive === true

  if (noInput) {
    return runNonInteractive(services, opts)
  }

  p.intro("claw-mem bootstrap prod")

  // 1. RPC URL
  const rpcUrl = String(await must(
    p.text({
      message: "COC L1 RPC URL:",
      defaultValue: opts.rpc ?? services.config.backup.rpcUrl,
      placeholder: "https://rpc.coc.network",
      validate: (v) => v.trim().startsWith("http") ? undefined : "must be an http(s) URL",
    }),
  ))

  // Validate RPC
  const provider = new JsonRpcProvider(rpcUrl)
  let chainId: bigint
  try {
    const net = await provider.getNetwork()
    chainId = net.chainId
    p.note(`chainId ${chainId}`, "RPC reachable")
  } catch (err) {
    p.cancel(`RPC ${rpcUrl} unreachable: ${String(err)}`)
    return
  }

  // 2. Required contracts
  const poseManager = await promptAddress("PoSeManager address:", opts.poseManager, provider)
  if (!poseManager) return

  const soulRegistry = await promptAddress("SoulRegistry address:", opts.soulRegistry, provider)
  if (!soulRegistry) return

  // 3. Optional contracts
  const wantDid = await must(p.confirm({ message: "Configure DIDRegistry?", initialValue: Boolean(opts.didRegistry) }))
  let didRegistry: string | undefined
  if (wantDid) {
    didRegistry = await promptAddress("DIDRegistry address:", opts.didRegistry, provider)
    if (!didRegistry) return
  }

  const wantCid = await must(p.confirm({ message: "Configure CidRegistry?", initialValue: Boolean(opts.cidRegistry) }))
  let cidRegistry: string | undefined
  if (wantCid) {
    cidRegistry = await promptAddress("CidRegistry address:", opts.cidRegistry, provider)
    if (!cidRegistry) return
  }

  // 4. Operator key
  const keyChoice = await must(p.select({
    message: "Operator private key:",
    options: [
      { value: "paste", label: "Paste an existing key", hint: "0x + 64 hex chars" },
      { value: "generate", label: "Generate a NEW key", hint: "you must fund it before backups will work" },
    ],
  }))

  let privateKey: string
  if (keyChoice === "paste") {
    privateKey = String(await must(p.password({
      message: "Paste 0x-prefixed 64-hex private key:",
      validate: (v) => KEY_RE.test(v.trim()) ? undefined : "must be 0x + 64 hex chars",
    })))
  } else {
    const w = Wallet.createRandom()
    privateKey = w.privateKey
    p.note(`address: ${w.address}\nkey:     ${w.privateKey}`, "Generated — SAVE THIS")
  }

  // 5. Balance check
  const wallet = new Wallet(privateKey, provider)
  try {
    const balance = await provider.getBalance(wallet.address)
    const eth = Number(formatEther(balance))
    if (eth < 0.01) {
      p.note(
        `address ${wallet.address}\nbalance ${eth} ETH (LOW — may not have enough for gas / bond)`,
        "Operator funded?",
      )
    } else {
      p.note(`address ${wallet.address}\nbalance ${eth} ETH`, "Operator")
    }
  } catch {
    /* swallow — chain may not support eth_getBalance for the user's address */
  }

  // 6. Persist
  await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
    setDotPath(cfg, "bootstrap.mode", "prod")
    setDotPath(cfg, "backup.rpcUrl", rpcUrl)
    setDotPath(cfg, "backup.contractAddress", soulRegistry)
    setDotPath(cfg, "backup.privateKey", privateKey)
    if (didRegistry) setDotPath(cfg, "backup.didRegistryAddress", didRegistry)
  })

  // Record contracts in artifact store under the resolved network name.
  const network = describeNetwork(chainId)
  services.artifactStore.set({ key: "pose_manager", value: poseManager, network, chainId: Number(chainId) })
  services.artifactStore.set({ key: "soul_registry", value: soulRegistry, network, chainId: Number(chainId) })
  if (didRegistry) services.artifactStore.set({ key: "did_registry", value: didRegistry, network, chainId: Number(chainId) })
  if (cidRegistry) services.artifactStore.set({ key: "cid_registry", value: cidRegistry, network, chainId: Number(chainId) })

  const next = [
    `mode:           prod`,
    `network:        ${network} (chainId ${chainId})`,
    `rpcUrl:         ${rpcUrl}`,
    `soulRegistry:   ${soulRegistry}`,
    `poseManager:    ${poseManager}`,
    didRegistry ? `didRegistry:    ${didRegistry}` : null,
    cidRegistry ? `cidRegistry:    ${cidRegistry}` : null,
    `operator addr:  ${wallet.address}`,
    `privateKey:     written to ${DEFAULT_CONFIG_PATH} (chmod 600 the file!)`,
    ``,
    `Next:`,
    `  - claw-mem doctor                # verify environment`,
    `  - claw-mem backup register       # create your soul on-chain`,
    `  - claw-mem backup heartbeat      # keep your agent alive`,
    `  - claw-mem backup create         # try a backup`,
  ].filter(Boolean) as string[]
  p.note(next.join("\n"), "Production bootstrap complete")
  p.outro("ready")
}

async function runNonInteractive(services: CliServices, opts: ProdBootstrapOptions): Promise<void> {
  const required = { rpc: opts.rpc, poseManager: opts.poseManager, soulRegistry: opts.soulRegistry, privateKey: opts.privateKey }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`missing required flags: ${missing.join(", ")}`)
  }
  if (!ADDR_RE.test(opts.poseManager!)) throw new Error("--pose-manager is not a valid 0x address")
  if (!ADDR_RE.test(opts.soulRegistry!)) throw new Error("--soul-registry is not a valid 0x address")
  if (opts.didRegistry && !ADDR_RE.test(opts.didRegistry)) throw new Error("--did-registry is not a valid 0x address")
  if (opts.cidRegistry && !ADDR_RE.test(opts.cidRegistry)) throw new Error("--cid-registry is not a valid 0x address")
  if (!KEY_RE.test(opts.privateKey!)) throw new Error("--private-key must be 0x + 64 hex chars")

  const provider = new JsonRpcProvider(opts.rpc!)
  const net = await provider.getNetwork()
  for (const [label, addr] of [
    ["pose-manager", opts.poseManager!],
    ["soul-registry", opts.soulRegistry!],
    ...(opts.didRegistry ? [["did-registry", opts.didRegistry]] : []),
    ...(opts.cidRegistry ? [["cid-registry", opts.cidRegistry]] : []),
  ] as Array<[string, string]>) {
    const code = await provider.getCode(addr)
    if (code === "0x") throw new Error(`${label} ${addr} has no bytecode at this RPC`)
  }

  await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
    setDotPath(cfg, "bootstrap.mode", "prod")
    setDotPath(cfg, "backup.rpcUrl", opts.rpc!)
    setDotPath(cfg, "backup.contractAddress", opts.soulRegistry!)
    setDotPath(cfg, "backup.privateKey", opts.privateKey!)
    if (opts.didRegistry) setDotPath(cfg, "backup.didRegistryAddress", opts.didRegistry)
  })

  const network = describeNetwork(net.chainId)
  services.artifactStore.set({ key: "pose_manager", value: opts.poseManager!, network, chainId: Number(net.chainId) })
  services.artifactStore.set({ key: "soul_registry", value: opts.soulRegistry!, network, chainId: Number(net.chainId) })
  if (opts.didRegistry) services.artifactStore.set({ key: "did_registry", value: opts.didRegistry, network, chainId: Number(net.chainId) })
  if (opts.cidRegistry) services.artifactStore.set({ key: "cid_registry", value: opts.cidRegistry, network, chainId: Number(net.chainId) })

  console.log(`bootstrap prod (non-interactive) configured for chainId ${net.chainId} (${network})`)
}

async function promptAddress(message: string, prefilled: string | undefined, provider: JsonRpcProvider): Promise<string | undefined> {
  let value = prefilled
  if (!value) {
    const r = await p.text({
      message,
      placeholder: "0x" + "0".repeat(40),
      validate: (v) => ADDR_RE.test(v.trim()) ? undefined : "must be a 0x-prefixed 40-hex address",
    })
    if (p.isCancel(r)) { p.cancel("cancelled"); return undefined }
    value = (r as string).trim()
  }
  // Validate bytecode at this address.
  try {
    const code = await provider.getCode(value)
    if (code === "0x") {
      const proceed = await p.confirm({
        message: `${value} has no bytecode at this RPC. Use anyway?`,
        initialValue: false,
      })
      if (p.isCancel(proceed) || !proceed) { p.cancel("cancelled"); return undefined }
    }
  } catch {
    /* fall through — RPC may not support eth_getCode */
  }
  return value
}

async function must<T>(input: T | symbol | Promise<T | symbol>): Promise<T> {
  const v = await input
  if (p.isCancel(v)) {
    p.cancel("cancelled")
    process.exit(0)
  }
  return v as T
}

function describeNetwork(chainId: bigint): string {
  const n = Number(chainId)
  switch (n) {
    case 1: return "mainnet"
    case 11155111: return "sepolia"
    case 31337: return "local"
    case 18780: return "coc-testnet"
    default: return `chain-${n}`
  }
}
