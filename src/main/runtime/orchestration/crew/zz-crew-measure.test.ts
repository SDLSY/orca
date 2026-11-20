import { afterEach, it, vi } from 'vitest'
import { fixture } from './crew-read-model.test-fixture'
import { seedLegacyCrewLoad, LEGACY_COORDINATOR } from './legacy-crew-load.test-fixture'
import { CrewReadModel, CREW_HOST_GRACE_MS } from './crew-read-model'
import { subscribeCrew } from './crew-stream'
import { createCrewHostDerivation } from './crew-host-derivation'
import { readCrewAssignments, readCrewApprovals, readCrewOwnedRunAddresses } from './crew-query'
import { LEGACY_CONTRACT_VERSION } from '../db/contract-constants'
import { setActiveSink } from '../../../observability/tracer'

afterEach(() => setActiveSink(null))
const time = <T>(label: string, fn: () => T): T => {
  const start = performance.now()
  const value = fn()
  console.log(`${label}: ${(performance.now() - start).toFixed(1)} ms`)
  return value
}
const R = 'run_legacy_adopted'
const A = '2026-11-10 00:00:00'

it('measures', async () => {
  const f = fixture()
  const big = process.env.CREW_BIG === '1'
  time('seed', () =>
    seedLegacyCrewLoad(
      f.db,
      big ? { dispatches: 1400, creatorTasks: 330, mail: 30_000 } : undefined
    )
  )
  const plan = (label: string, sql: string, args: unknown[]) => {
    console.log(
      `PLAN ${label}\n${f.db.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(args as string[]))
        .map((r) => `  ${(r as { detail: string }).detail}`)
        .join('\n')}`
    )
    time(label, () => f.db.db.prepare(sql).all(...(args as string[])))
  }
  const durable = (
    plus: string
  ) => `SELECT coordinator_handle AS handle FROM coordinator_runs WHERE scheduler_lost_at = ?
       UNION SELECT created_by_terminal_handle AS handle FROM tasks t
       WHERE t.run_id = ? AND t.created_by_terminal_handle IS NOT NULL AND t.created_at <= ?
         AND EXISTS(SELECT 1 FROM dispatch_contexts d WHERE d.task_id = t.id AND ${plus}d.run_id = t.run_id)`
  plan('durable old', durable(''), [A, R, A])
  plan('durable new', durable('+'), [A, R, A])
  const oldMail = `SELECT m.to_handle AS handle FROM messages m INNER JOIN dispatch_contexts d
         ON d.run_id = m.run_id AND d.contract_version = ?
        AND (m.from_handle = d.assignee_handle OR m.from_handle = 'dispatch:' || d.id)
       WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct' AND m.created_at <= ?
       UNION SELECT m.from_handle AS handle FROM messages m INNER JOIN dispatch_contexts d
         ON d.run_id = m.run_id AND d.contract_version = ?
        AND (m.to_handle = d.assignee_handle OR m.to_handle = 'dispatch:' || d.id)
       WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct' AND m.created_at <= ?`
  plan('mail old', oldMail, [LEGACY_CONTRACT_VERSION, R, A, LEGACY_CONTRACT_VERSION, R, A])
  const owner = time('getUniqueLegacyCoordinatorHandle (new code)', () =>
    f.db.getUniqueLegacyCoordinatorHandle(R)
  )
  console.log('owner', owner)
  time('readCrewAssignments', () => readCrewAssignments(f.db, Date.now()))
  time('readCrewApprovals', () => readCrewApprovals(f.db, [LEGACY_COORDINATOR, `run:${R}`]))
  time('readCrewOwnedRunAddresses', () =>
    readCrewOwnedRunAddresses(f.db, {
      terminalHandle: LEGACY_COORDINATOR,
      paneKey: null,
      orcaSessionId: null
    })
  )
  time('createCrewHostDerivation', () => createCrewHostDerivation(f.deps))

  const spans: { trigger: string; elapsedMs: number }[] = []
  setActiveSink({
    push: (r) => {
      const rec = r as { name: string; attributes: { trigger: string; elapsedMs: number } }
      if (rec.name === 'orchestration.crew.rebuild') {
        spans.push(rec.attributes)
      }
    },
    flush: () => {},
    close: () => {}
  })
  const report = (label: string) => {
    console.log(
      `${label}: ${spans.length} rebuilds ${JSON.stringify(spans.map((s) => `${s.trigger}:${s.elapsedMs}ms`))}`
    )
    spans.length = 0
  }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const model = new CrewReadModel(() => f.deps, f.db.crewChanges.subscribe)
  const sub = (party: string) =>
    subscribeCrew(
      () => model.read(party),
      (wake) => model.subscribe(wake, party),
      () => {}
    )
  time('one subscribe + snapshot', () => sub(LEGACY_COORDINATOR)())
  report('one subscribe')
  vi.advanceTimersByTime(CREW_HOST_GRACE_MS + 1)
  const parties = [LEGACY_COORDINATOR, 'term_lw1', 'term_lw2']
  const stops = time('ten subscribes in one tick', () =>
    Array.from({ length: 10 }, (_, i) => sub(parties[i % 3]))
  )
  report('ten subscribes')
  f.db.crewChanges.notify()
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
  }
  report('ten subscribers woken by one broad change')
  stops.forEach((s) => s())
  time('20 hide/show within grace', () => {
    for (let i = 0; i < 20; i++) {
      sub(LEGACY_COORDINATOR)()
    }
  })
  report('20 hide/show within grace')
  time('20 hide/show past grace (old behavior)', () => {
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(CREW_HOST_GRACE_MS + 1)
      sub(LEGACY_COORDINATOR)()
    }
  })
  report('20 hide/show past grace (old behavior)')
  vi.useRealTimers()
}, 600_000)
