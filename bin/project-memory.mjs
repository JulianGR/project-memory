import { initializeProject, isInitialized, recordPrompt, formatReminder, resolveInterval, stateRootFor } from '../lib/project-memory.mjs'

function hostFrom(args) {
  const hostIndex = args.indexOf('--host')
  if (hostIndex >= 0) return args[hostIndex + 1] || 'claude'
  const value = args.find((argument) => argument.startsWith('--host='))
  return value ? value.slice('--host='.length) : 'claude'
}

async function eventFromInput() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input.trim() ? JSON.parse(input) : {}
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['init', 'session-start', 'prompt', 'status'].includes(command)) throw new Error(`Unknown command: ${command || ''}`)
  const lifecycle = command === 'session-start' || command === 'prompt'
  try {
    const event = await eventFromInput()
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Hook event must be an object')
    const root = event.cwd || process.cwd()
    const host = hostFrom(args)

    if (command === 'init') {
      process.stdout.write(`${JSON.stringify(await initializeProject(root))}\n`)
      return
    }

    if (command === 'session-start') return

    if (command === 'status') {
      process.stdout.write(`${JSON.stringify({ initialized: await isInitialized(root) })}\n`)
      return
    }

    if (await isInitialized(root)) {
      const state = await recordPrompt({ host, event, stateRoot: stateRootFor(), interval: resolveInterval() })
      if (state.due) process.stdout.write(`${formatReminder(host, state)}\n`)
    }
  } catch (error) {
    if (!lifecycle) throw error
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
