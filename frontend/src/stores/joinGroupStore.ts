import { createStore } from 'zustand/vanilla'
import type { JoinGroup, JoinMember } from '@/types'
import { isGroupActive } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface JoinGroupState {
  groups: JoinGroup[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (group: JoinGroup) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 确认候选组；members 传入时以当前编目快照覆盖（保证深度序最新） */
  confirm: (id: string, members?: JoinMember[]) => Promise<void>
  revoke: (id: string, reason: string) => Promise<void>
}

export const joinGroupStore = createStore<JoinGroupState>((set, get) => ({
  groups: [],
  loaded: false,
  hydrate: async () => {
    const groups = await syncAll<JoinGroup>(db.joinGroups)
    groups.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.code.localeCompare(b.code))
    set({ groups, loaded: true })
  },
  save: async (group) => {
    await syncPut<JoinGroup>(db.joinGroups, group)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<JoinGroup>(db.joinGroups, id)
    await get().hydrate()
  },
  confirm: async (id, members) => {
    const group = get().groups.find((item) => item.id === id)
    if (!group || !isGroupActive(group)) return
    await syncPut<JoinGroup>(db.joinGroups, {
      ...group,
      ...(members ? { members } : {}),
      status: '已确认',
      confirmedAt: group.confirmedAt || new Date().toISOString()
    })
    await get().hydrate()
  },
  revoke: async (id, reason) => {
    const group = get().groups.find((item) => item.id === id)
    if (!group || !isGroupActive(group)) return
    await syncPut<JoinGroup>(db.joinGroups, {
      ...group,
      status: '已撤销',
      revokedAt: new Date().toISOString(),
      revokeReason: reason.trim()
    })
    await get().hydrate()
  }
}))
