/**
 * Test fixture: identity projection
 *
 * State: Set<string> of roleIds that have been activated.
 *
 * - 'core.role.activated' → add roleId to set
 * - anything else → no-op
 *
 * Pure fold: no Date / Math.random / I/O.
 */
import type { Projection } from '../../Projection.js'
import type { EventStoreRow } from '../../types.js'

export interface IdentityState {
  roles: Set<string>
  activations: Array<{ ts: number; id: string; sessionId: string | null }>
}

const identityProjection: Projection<IdentityState> = {
  name: 'test.identity',
  initial: { roles: new Set(), activations: [] },
  reduce(state: IdentityState, event: EventStoreRow): IdentityState {
    if (event.type === 'core.role.activated') {
      const payload = event.payload as { roleId?: string } | null
      const roleId = payload?.roleId
      if (!roleId) return state
      const nextRoles = new Set(state.roles)
      nextRoles.add(roleId)
      return {
        roles: nextRoles,
        activations: [...state.activations, { ts: event.ts, id: roleId, sessionId: event.sessionId }],
      }
    }
    return state
  },
}

export default identityProjection