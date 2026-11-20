// Perf contracts for the crew subscribe stall in 1.4.266 (follow-up to #45290).
import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from './crew-read-model.test-fixture'
import { seedLegacyCrewLoad, LEGACY_COORDINATOR } from './legacy-crew-load.test-fixture'
import { CrewReadModel, CREW_HOST_GRACE_MS } from './crew-read-model'
import { subscribeCrew } from './crew-stream'

afterEach(() => vi.useRealTimers())

it('finds the legacy coordinator without probing dispatches by Run once per task or message', () => {
  const f = fixture()
  const { adoptedRunId } = seedLegacyCrewLoad(f.db, {
    dispatches: 300,
    creatorTasks: 80,
    mail: 3000
  })
  const statements: string[] = []
  const prepare = f.db.db.prepare.bind(f.db.db)
  f.db.db.prepare = (sql: string) => {
    statements.push(sql)
    return prepare(sql)
  }
  expect(f.db.getUniqueLegacyCoordinatorHandle(adoptedRunId)).toBe(LEGACY_COORDINATOR)
  f.db.db.prepare = prepare
  const plans = statements.flatMap((sql) =>
    prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array.from(sql.matchAll(/\?/g), () => null))
      .map((row) => String((row as { detail: unknown }).detail))
  )
  // A per-row lookup of `d` by run_id scans a whole Run's Dispatches for each task or message.
  expect(plans.filter((detail) => /^SEARCH d USING .*\(run_id=/.test(detail))).toEqual([])
})

it('keeps the shared crew host across a chat hidden and shown 20 times', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const f = fixture()
  seedLegacyCrewLoad(f.db, { dispatches: 50, creatorTasks: 10, mail: 200 })
  let builds = 0
  const model = new CrewReadModel((previous) => {
    if (!previous) {
      builds++
    }
    return f.deps
  }, f.db.crewChanges.subscribe)
  for (let i = 0; i < 20; i++) {
    subscribeCrew(
      () => model.read(LEGACY_COORDINATOR),
      (wake) => model.subscribe(wake, LEGACY_COORDINATOR),
      () => {}
    )()
  }
  expect(builds).toBe(1)
  vi.advanceTimersByTime(CREW_HOST_GRACE_MS)
  subscribeCrew(
    () => model.read(LEGACY_COORDINATOR),
    (wake) => model.subscribe(wake, LEGACY_COORDINATOR),
    () => {}
  )()
  expect(builds).toBe(2)
})
