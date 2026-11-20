import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { rememberManagedAgentRelease } from '../../managed-agent-cli/managed-agent-cli-registry'
import { resolveStructuredAgentCommand } from './structured-agent-command-resolution'

const RELEASE = join('/orca-data', 'agent-runtimes', 'agy', '1.5.13')
const AGY = join(RELEASE, process.platform === 'win32' ? 'agy.exe' : 'agy')

afterEach(() => rememberManagedAgentRelease('antigravity', null))

it.each([
  ['agy', AGY],
  ['agy_acp_server.par', 'agy_acp_server.par']
])('Orca’s agy stands in only for a missing `agy`: %s resolves to %s', (command, expected) => {
  rememberManagedAgentRelease('antigravity', RELEASE)

  const resolved = resolveStructuredAgentCommand(
    'antigravity',
    {},
    { pathEnv: '' },
    { command, resolve: (name) => name }
  )

  expect(resolved).toEqual({ command: expected, prefixArgs: [] })
})
