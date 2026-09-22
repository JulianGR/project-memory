import { initializeProject, projectPath, projectStatus, reviewInstruction } from '../lib/project-memory.mjs'

function optionsFrom(args, allowed) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(args[index])
    if (!match || !allowed.includes(match[1])) throw new Error(`Unknown option: ${args[index]}`)
    const value = match[2] ?? args[++index]
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new Error(`Missing value for --${match[1]}`)
    if (options[match[1]] !== undefined) throw new Error(`Duplicate option: --${match[1]}`)
    options[match[1]] = value
  }
  return options
}

async function eventFromInput() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const event = input.trim() ? JSON.parse(input) : {}
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Hook event must be an object')
  return event
}

function hostFrom(options, event) {
  const host = options.host ?? (typeof event.turn_id === 'string' && event.turn_id.trim() ? 'codex' : 'claude')
  if (!['claude', 'codex', 'kimi'].includes(host)) throw new Error(`Unknown host: ${host}`)
  return host
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const lifecycle = command === 'stop'
  if (!lifecycle && !['init', 'status'].includes(command)) throw new Error(`Unknown command: ${command || ''}`)
  try {
    const options = optionsFrom(args, lifecycle ? ['host'] : ['project'])
    if (!lifecycle) {
      if (!options.project) throw new Error('Specify the target project with --project <directory>.')
      const root = projectPath(options.project)
      emit(command === 'init' ? await initializeProject(root) : await projectStatus(root))
      return
    }
    const event = await eventFromInput()
    if (event.stop_hook_active !== undefined && event.stop_hook_active !== false) return
    const root = projectPath(event.cwd)
    const host = hostFrom(options, event)
    const status = await projectStatus(root)
    if (!status.active) return
    const reason = reviewInstruction(root, status.initialized)
    if (host === 'claude') {
      emit({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason } })
    } else if (host === 'kimi') {
      emit({ hookSpecificOutput: { hookEventName: 'Stop', permissionDecision: 'deny', permissionDecisionReason: reason } })
    } else {
      emit({ decision: 'block', reason })
    }
  } catch (error) {
    if (!lifecycle) throw error
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
