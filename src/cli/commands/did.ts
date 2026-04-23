// `claw-mem did ...` — DID identity management (DIDRegistry operations).
// All commands fail loudly when backup.didRegistryAddress is not set.

import type { Command } from "commander"
import type { CliServices } from "../register-all.ts"
import type { DIDClient } from "../../services/did-client.ts"

export function registerDidCommands(program: Command, services: CliServices): void {
  const { backupManager, logger } = services
  const did = program.command("did").description("DID identity management (DIDRegistry operations)")

  function getDid(): DIDClient {
    const client = backupManager.getDidClient()
    if (!client) {
      logger.error(
        "DID operations require backup.didRegistryAddress. Set it with " +
          "`claw-mem config set backup.didRegistryAddress <addr>` and restart.",
      )
      process.exit(1)
    }
    return client
  }

  did
    .command("add-key")
    .description("Add a verification method to the DID Document")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--key-id <id>", "Key identifier (bytes32)")
    .requiredOption("--key-address <addr>", "Key Ethereum address")
    .requiredOption("--purpose <mask>", "Key purpose bitmask (1=auth, 2=assertion, 4=capInvoke, 8=capDelegate)")
    .action(async (opts: { agentId: string; keyId: string; keyAddress: string; purpose: string }) => {
      try {
        const txHash = await getDid().addVerificationMethod(
          opts.agentId, opts.keyId, opts.keyAddress, parseInt(opts.purpose),
        )
        console.log(`Verification method added (key ${opts.keyId}, tx ${txHash})`)
      } catch (error) { fail("Add key", error) }
    })

  did
    .command("revoke-key")
    .description("Revoke a verification method")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--key-id <id>", "Key identifier (bytes32)")
    .action(async (opts: { agentId: string; keyId: string }) => {
      try {
        const txHash = await getDid().revokeVerificationMethod(opts.agentId, opts.keyId)
        console.log(`Verification method revoked (tx ${txHash})`)
      } catch (error) { fail("Revoke key", error) }
    })

  did
    .command("delegate")
    .description("Grant a delegation to another agent")
    .requiredOption("--delegator <id>", "Delegator agent ID (bytes32)")
    .requiredOption("--delegatee <id>", "Delegatee agent ID (bytes32)")
    .requiredOption("--scope <hash>", "Scope hash (bytes32)")
    .requiredOption("--expires <ts>", "Expiration unix timestamp")
    .option("--parent <id>", "Parent delegation ID (bytes32)", "0x" + "0".repeat(64))
    .option("--depth <n>", "Delegation depth (0-3)", "1")
    .action(async (opts: { delegator: string; delegatee: string; scope: string; expires: string; parent: string; depth: string }) => {
      try {
        const txHash = await getDid().grantDelegation(
          opts.delegator, opts.delegatee, opts.parent,
          opts.scope, parseInt(opts.expires), parseInt(opts.depth),
        )
        console.log(`Delegation granted (tx ${txHash})`)
      } catch (error) { fail("Delegate", error) }
    })

  did
    .command("revoke-delegation")
    .description("Revoke a delegation")
    .requiredOption("--delegation-id <id>", "Delegation ID (bytes32)")
    .action(async (opts: { delegationId: string }) => {
      try {
        const txHash = await getDid().revokeDelegation(opts.delegationId)
        console.log(`Delegation revoked (tx ${txHash})`)
      } catch (error) { fail("Revoke delegation", error) }
    })

  did
    .command("keys")
    .description("List active verification methods for an agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .option("--json", "Output JSON")
    .action(async (opts: { agentId: string; json?: boolean }) => {
      try {
        const methods = await getDid().getVerificationMethods(opts.agentId)
        if (opts.json) {
          console.log(JSON.stringify(methods, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Verification methods for ${opts.agentId}:`)
        for (const vm of methods) {
          console.log(`  ${vm.keyId} → ${vm.keyAddress} [purpose=${vm.keyPurpose}] ${vm.active ? "ACTIVE" : "REVOKED"}`)
        }
      } catch (error) { fail("List keys", error) }
    })

  did
    .command("delegations")
    .description("List delegations for an agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .option("--json", "Output JSON")
    .action(async (opts: { agentId: string; json?: boolean }) => {
      try {
        const delegations = await getDid().getDelegations(opts.agentId)
        if (opts.json) {
          console.log(JSON.stringify(delegations, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Delegations for ${opts.agentId}:`)
        for (const d of delegations) {
          const status = d.revoked ? "REVOKED" : "ACTIVE"
          console.log(`  ${d.delegationId} → ${d.delegatee} [scope=${d.scopeHash.slice(0, 10)}...] ${status}`)
        }
      } catch (error) { fail("List delegations", error) }
    })

  did
    .command("update-doc")
    .description("Update the DID document CID on-chain")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--document-cid <hash>", "New document CID hash (bytes32)")
    .action(async (opts: { agentId: string; documentCid: string }) => {
      try {
        const txHash = await getDid().updateDIDDocument(opts.agentId, opts.documentCid)
        console.log(`DID document updated (tx ${txHash})`)
      } catch (error) { fail("Update DID document", error) }
    })

  did
    .command("revoke-all-delegations")
    .description("Emergency: revoke all delegations for an agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .action(async (opts: { agentId: string }) => {
      try {
        const txHash = await getDid().revokeAllDelegations(opts.agentId)
        console.log(`All delegations revoked (tx ${txHash})`)
      } catch (error) { fail("Revoke all delegations", error) }
    })

  did
    .command("anchor-credential")
    .description("Anchor a verifiable credential on-chain")
    .requiredOption("--credential-hash <hash>", "Credential hash (bytes32)")
    .requiredOption("--issuer <id>", "Issuer agent ID (bytes32)")
    .requiredOption("--subject <id>", "Subject agent ID (bytes32)")
    .requiredOption("--credential-cid <hash>", "Credential CID hash (bytes32)")
    .requiredOption("--expires <ts>", "Expiration unix timestamp")
    .action(async (opts: { credentialHash: string; issuer: string; subject: string; credentialCid: string; expires: string }) => {
      try {
        const txHash = await getDid().anchorCredential(
          opts.credentialHash, opts.issuer, opts.subject,
          opts.credentialCid, parseInt(opts.expires),
        )
        console.log(`Credential anchored (tx ${txHash})`)
      } catch (error) { fail("Anchor credential", error) }
    })

  did
    .command("revoke-credential")
    .description("Revoke a verifiable credential")
    .requiredOption("--credential-id <id>", "Credential ID (bytes32)")
    .action(async (opts: { credentialId: string }) => {
      try {
        const txHash = await getDid().revokeCredential(opts.credentialId)
        console.log(`Credential revoked (tx ${txHash})`)
      } catch (error) { fail("Revoke credential", error) }
    })

  did
    .command("record-lineage")
    .description("Record agent lineage (fork relationship)")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--parent <id>", "Parent agent ID (bytes32)")
    .requiredOption("--fork-height <n>", "Fork block height")
    .requiredOption("--generation <n>", "Generation number")
    .action(async (opts: { agentId: string; parent: string; forkHeight: string; generation: string }) => {
      try {
        const txHash = await getDid().recordLineage(
          opts.agentId, opts.parent, parseInt(opts.forkHeight), parseInt(opts.generation),
        )
        console.log(`Lineage recorded (tx ${txHash})`)
      } catch (error) { fail("Record lineage", error) }
    })

  did
    .command("update-capabilities")
    .description("Update capability bitmask for an agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--capabilities <mask>", "Capability bitmask (uint16)")
    .action(async (opts: { agentId: string; capabilities: string }) => {
      try {
        const txHash = await getDid().updateCapabilities(opts.agentId, parseInt(opts.capabilities))
        console.log(`Capabilities updated (tx ${txHash})`)
      } catch (error) { fail("Update capabilities", error) }
    })

  did
    .command("create-ephemeral")
    .description("Create an ephemeral sub-identity")
    .requiredOption("--parent <id>", "Parent agent ID (bytes32)")
    .requiredOption("--ephemeral-id <id>", "Ephemeral identity ID (bytes32)")
    .requiredOption("--ephemeral-address <addr>", "Ephemeral address")
    .requiredOption("--scope <hash>", "Scope hash (bytes32)")
    .requiredOption("--expires <ts>", "Expiration unix timestamp")
    .action(async (opts: { parent: string; ephemeralId: string; ephemeralAddress: string; scope: string; expires: string }) => {
      try {
        const txHash = await getDid().createEphemeralIdentity(
          opts.parent, opts.ephemeralId, opts.ephemeralAddress,
          opts.scope, parseInt(opts.expires),
        )
        console.log(`Ephemeral identity created (tx ${txHash})`)
      } catch (error) { fail("Create ephemeral identity", error) }
    })

  did
    .command("deactivate-ephemeral")
    .description("Deactivate an ephemeral sub-identity")
    .requiredOption("--ephemeral-id <id>", "Ephemeral identity ID (bytes32)")
    .action(async (opts: { ephemeralId: string }) => {
      try {
        const txHash = await getDid().deactivateEphemeralIdentity(opts.ephemeralId)
        console.log(`Ephemeral identity deactivated (tx ${txHash})`)
      } catch (error) { fail("Deactivate ephemeral", error) }
    })

  function fail(label: string, error: unknown): never {
    logger.error(`${label} failed: ${String(error)}`)
    process.exit(1)
  }
}
