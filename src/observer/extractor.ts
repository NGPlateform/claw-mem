// Lightweight observation extractor: derives structured observations from tool calls
// without requiring a separate LLM call. Uses heuristics based on tool name and content.

import type { ObservationInput, ObservationType } from "../types.ts"

export interface ToolCallEvent {
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: string
  sessionId: string
  agentId: string
  promptNumber: number
}

// Tool name → likely observation type mapping
const TOOL_TYPE_MAP: Record<string, ObservationType> = {
  Read: "discovery",
  Grep: "discovery",
  Glob: "discovery",
  Write: "change",
  Edit: "change",
  Bash: "change",
  WebSearch: "discovery",
  WebFetch: "discovery",
}

const MAX_NARRATIVE_LENGTH = 500
const MAX_FACT_LENGTH = 200

/**
 * Extract an observation from a tool call event.
 * Returns null if the tool call doesn't warrant an observation.
 */
export function extractObservation(event: ToolCallEvent): ObservationInput | null {
  const { toolName, toolInput, toolOutput } = event

  // Skip tools that don't produce meaningful observations
  if (!toolOutput || toolOutput.length < 20) return null

  const type = TOOL_TYPE_MAP[toolName] ?? "discovery"
  const { title, facts, narrative, concepts, filesRead, filesModified } =
    extractContent(toolName, toolInput, toolOutput)

  if (!title) return null

  return {
    sessionId: event.sessionId,
    agentId: event.agentId,
    type,
    title,
    facts,
    narrative,
    concepts,
    filesRead,
    filesModified,
    toolName,
    promptNumber: event.promptNumber,
  }
}

function extractContent(
  toolName: string,
  input: Record<string, unknown>,
  output: string,
): {
  title: string
  facts: string[]
  narrative: string | null
  concepts: string[]
  filesRead: string[]
  filesModified: string[]
} {
  switch (toolName) {
    case "Read":
      return extractReadContent(input, output)
    case "Write":
      return extractWriteContent(input)
    case "Edit":
      return extractEditContent(input)
    case "Bash":
      return extractBashContent(input, output)
    case "Grep":
      return extractGrepContent(input, output)
    case "WebSearch":
      return extractSearchContent(input, output)
    default:
      return extractGenericContent(toolName, input, output)
  }
}

function extractReadContent(
  input: Record<string, unknown>,
  output: string,
): ReturnType<typeof extractContent> {
  const filePath = String(input.file_path ?? input.path ?? "")
  const fileName = filePath.split("/").pop() ?? filePath
  const lineCount = output.split("\n").length

  return {
    title: `Read ${fileName}`,
    facts: [`${lineCount} lines`, filePath],
    narrative: null,
    concepts: extractPathConcepts(filePath),
    filesRead: filePath ? [filePath] : [],
    filesModified: [],
  }
}

function extractWriteContent(input: Record<string, unknown>): ReturnType<typeof extractContent> {
  const filePath = String(input.file_path ?? "")
  const fileName = filePath.split("/").pop() ?? filePath
  const content = String(input.content ?? "")
  const lineCount = content.split("\n").length

  return {
    title: `Created ${fileName}`,
    facts: [`${lineCount} lines written`],
    narrative: null,
    concepts: extractPathConcepts(filePath),
    filesRead: [],
    filesModified: filePath ? [filePath] : [],
  }
}

function extractEditContent(input: Record<string, unknown>): ReturnType<typeof extractContent> {
  const filePath = String(input.file_path ?? "")
  const fileName = filePath.split("/").pop() ?? filePath
  const oldStr = String(input.old_string ?? "")
  const newStr = String(input.new_string ?? "")

  const addedLines = newStr.split("\n").length
  const removedLines = oldStr.split("\n").length

  return {
    title: `Edited ${fileName}`,
    facts: [`+${addedLines}/-${removedLines} lines`],
    narrative: null,
    concepts: extractPathConcepts(filePath),
    filesRead: [],
    filesModified: filePath ? [filePath] : [],
  }
}

function extractBashContent(
  input: Record<string, unknown>,
  output: string,
): ReturnType<typeof extractContent> {
  const command = String(input.command ?? "")
  const shortCmd = command.length > 80 ? command.slice(0, 77) + "..." : command

  // Extract key info from common commands
  const facts: string[] = []
  if (output.includes("error") || output.includes("Error") || output.includes("FAIL")) {
    facts.push("Command produced errors")
  }
  if (output.includes("pass") || output.includes("PASS") || output.includes("ok ")) {
    facts.push("Tests passing")
  }

  return {
    title: `Ran: ${shortCmd}`,
    facts,
    narrative: output.length > MAX_NARRATIVE_LENGTH ? output.slice(0, MAX_NARRATIVE_LENGTH) + "..." : output,
    concepts: extractCommandConcepts(command),
    filesRead: [],
    filesModified: [],
  }
}

function extractGrepContent(
  input: Record<string, unknown>,
  output: string,
): ReturnType<typeof extractContent> {
  const pattern = String(input.pattern ?? "")
  const matchCount = output.split("\n").filter(Boolean).length

  return {
    title: `Searched for "${pattern}"`,
    facts: [`${matchCount} matches found`],
    narrative: null,
    concepts: [],
    filesRead: [],
    filesModified: [],
  }
}

function extractSearchContent(
  input: Record<string, unknown>,
  output: string,
): ReturnType<typeof extractContent> {
  const query = String(input.query ?? "")
  return {
    title: `Web search: ${query}`,
    facts: [],
    narrative: output.length > MAX_NARRATIVE_LENGTH ? output.slice(0, MAX_NARRATIVE_LENGTH) + "..." : null,
    concepts: [],
    filesRead: [],
    filesModified: [],
  }
}

function extractGenericContent(
  toolName: string,
  input: Record<string, unknown>,
  output: string,
): ReturnType<typeof extractContent> {
  const inputSummary = Object.keys(input).slice(0, 3).join(", ")
  return {
    title: `${toolName}(${inputSummary})`,
    facts: [],
    narrative: output.length > MAX_NARRATIVE_LENGTH ? output.slice(0, MAX_NARRATIVE_LENGTH) + "..." : null,
    concepts: [],
    filesRead: [],
    filesModified: [],
  }
}

function extractPathConcepts(filePath: string): string[] {
  const concepts: string[] = []
  const ext = filePath.split(".").pop()?.toLowerCase()
  if (ext === "ts" || ext === "tsx") concepts.push("typescript")
  if (ext === "js" || ext === "jsx") concepts.push("javascript")
  if (ext === "sol") concepts.push("solidity")
  if (ext === "py") concepts.push("python")
  if (ext === "rs") concepts.push("rust")
  if (ext === "go") concepts.push("go")
  if (filePath.includes("test")) concepts.push("testing")
  if (filePath.includes("config") || filePath.includes(".json")) concepts.push("configuration")
  return concepts
}

function extractCommandConcepts(command: string): string[] {
  const concepts: string[] = []
  if (command.includes("test") || command.includes("vitest") || command.includes("jest")) concepts.push("testing")
  if (command.includes("git")) concepts.push("git")
  if (command.includes("npm") || command.includes("pnpm") || command.includes("bun")) concepts.push("package-management")
  if (command.includes("docker")) concepts.push("docker")
  if (command.includes("curl") || command.includes("fetch")) concepts.push("http")
  return concepts
}
