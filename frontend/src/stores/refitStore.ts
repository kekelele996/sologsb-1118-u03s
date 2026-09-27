import { createStore } from 'zustand/vanilla'
import type { RefitGroup } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'

export interface RefitState {
  groups: RefitGroup[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 缀合组只增改不删：撤销走状态流转，旧组与成员快照继续可查 */
  save: (group: RefitGroup) => Promise<void>
}

export const refitStore = createStore<RefitState>((set, get) => ({
  groups: [],
  loaded: false,
  hydrate: async () => {
    const groups = await syncAll<RefitGroup>(db.refits)
    groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
    set({ groups, loaded: true })
  },
  save: async (group) => {
    await syncPut<RefitGroup>(db.refits, group)
    await get().hydrate()
  }
}))
