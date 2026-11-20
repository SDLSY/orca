import { startSpan } from '../../../observability/tracer'
import type { CrewFacet } from './crew-changes'
import { createCrewHostDerivation, type CrewHostDerivation } from './crew-host-derivation'
import type { CrewReadDependencies } from './crew-read-dependencies'

export type CrewRebuildTrigger =
  | 'first-subscribe'
  | 'one-shot'
  | 'topology'
  | 'records'
  | 'clock'
  | 'expiry'
  | 'status-identity'
  | 'stale-dispatch'

/** Why a full rebuild runs, from what the read found. */
export function crewRebuildTrigger(
  previous: { now: number } | undefined,
  listening: boolean,
  dirty: ReadonlySet<CrewFacet>,
  now: number,
  cause?: CrewRebuildTrigger
): CrewRebuildTrigger {
  if (!previous) {
    return listening ? 'first-subscribe' : 'one-shot'
  }
  if (cause) {
    return cause
  }
  if (dirty.has('topology')) {
    return 'topology'
  }
  if (dirty.has('records')) {
    return 'records'
  }
  return now < previous.now ? 'clock' : 'expiry'
}

/** Builds hosts for one read model, recording each rebuild in the main-process trace (a no-op span without a sink). */
export function crewHostBuilder(listeners: () => number) {
  let rebuilds = 0
  return (trigger: CrewRebuildTrigger, deps: CrewReadDependencies): CrewHostDerivation => {
    const started = performance.now()
    const host = createCrewHostDerivation(deps, () => Math.max(32, listeners() * 2))
    startSpan('orchestration.crew.rebuild', {
      attributes: {
        trigger,
        elapsedMs: Math.round(performance.now() - started),
        assignments: host.assignmentsById.size,
        statuses: host.deps.statuses.length,
        listeners: listeners(),
        rebuilds: ++rebuilds
      }
    }).end()
    return host
  }
}
