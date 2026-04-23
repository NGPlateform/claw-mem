// Wire all agent tool registrations onto the OpenClaw PluginApi.

import type { CliServices } from "../cli/register-all.ts"
import type { PluginApi } from "../types.ts"
import { registerMemTools } from "./mem-tools.ts"
import { registerNodeTools } from "./node-tools.ts"
import { registerSoulTools } from "./soul-tools.ts"

export function registerAllTools(api: PluginApi, services: CliServices): void {
  registerMemTools(api, services)
  registerNodeTools(api, services)
  registerSoulTools(api, services)
  // carrier / guardian / DID tools added in a follow-up PR.
}
