import { formatContext, initializeProject, isInitialized, projectPath, reviewInstruction } from '../lib/project-memory.mjs'

const initializationMarker = 'agent-memory:init'
const lifecycleCommands = ['session-start', 'prompt', 'stop']

function hostFrom(args) {
  const index = args.indexOf('--host')
  const value = args.find((argument) => argument.startsWith('--host='))
  const host = index >= 0 ? args[index + 1] : value?.slice('--host='.length) || 'claude'
  if (!['claude', 'codex', 'kimi'].includes(host)) throw new Error(`Unknown host: ${host}`)
  return host
}

async function eventFromInput() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const event = input.trim() ? JSON.parse(input) : {}
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Hook event must be an object')
  return event
}

function isInitializationMarker(event) {
  return ['prompt', 'user_prompt', 'userPrompt', 'message', 'input'].some((key) => event[key] === initializationMarker)
}

function emit(message) {
  process.stdout.write(`${message}\n`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const lifecycle = lifecycleCommands.includes(command)
  if (!lifecycle && !['init', 'status'].includes(command)) throw new Error(`Unknown command: ${command || ''}`)
  try {
    const event = await eventFromInput()
    const root = projectPath(lifecycle ? event.cwd : event.cwd ?? process.cwd())
    const host = hostFrom(args)
    if (command === 'init') {
      emit(JSON.stringify(await initializeProject(root)))
      return
    }
    if (command === 'status') {
      emit(JSON.stringify({ initialized: await isInitialized(root) }))
      return
    }
    if (command === 'prompt' && isInitializationMarker(event)) {
      await initializeProject(root)
      emit(formatContext(host, 'UserPromptSubmit', `Project memory initialized in AGENTS.md. ${reviewInstruction(root)}`))
      return
    }
    if (!await isInitialized(root)) return
    if (command === 'stop') {
      if (host === 'kimi' || event.stop_hook_active === true) return
      if (event.stop_hook_active !== undefined && event.stop_hook_active !== false) return
      emit(JSON.stringify({ decision: 'block', reason: reviewInstruction(root) }))
      return
    }
    const hookEventName = command === 'session-start' ? 'SessionStart' : 'UserPromptSubmit'
    emit(formatContext(host, hookEventName, reviewInstruction(root)))
  } catch (error) {
    if (!lifecycle) throw error
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
