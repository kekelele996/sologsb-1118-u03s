import { onUnmounted, reactive } from 'vue'
import type { StoreApi } from 'zustand/vanilla'
import Dexie, { type Table } from 'dexie'
import type { Artifact, RefitGroup, Relation, Stratum, Trench } from '@/types'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：探方 / 地层单位 / 出土物 / 层位关系 / 器物缀合组 五张表 + 元数据表 */
class TrenchLogDb extends Dexie {
  trenches!: Table<Trench, string>
  strata!: Table<Stratum, string>
  artifacts!: Table<Artifact, string>
  relations!: Table<Relation, string>
  refits!: Table<RefitGroup, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbtrenchlog')
    this.version(1).stores({
      trenches: 'id, code, area',
      strata: 'id, trenchId, code, type',
      artifacts: 'id, stratumId, code, category',
      relations: 'id, unitAId, unitBId, type',
      meta: 'key'
    })
    // v2：地层单位新增「开口层位」字段，迁移时为历史数据补齐默认值
    this.version(2)
      .stores({
        trenches: 'id, code, area, backfilled',
        strata: 'id, trenchId, code, type, topDepth',
        artifacts: 'id, stratumId, code, category, date',
        relations: 'id, unitAId, unitBId, type, basis',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table<Stratum, string>('strata')
          .toCollection()
          .modify((stratum) => {
            if (!stratum.openLayer) {
              stratum.openLayer = '第①层'
            }
            if (!Array.isArray(stratum.inclusions)) {
              stratum.inclusions = []
            }
          })
      })
    // v3：新增「器物缀合组」表，历史表结构不变，无需迁移字段
    this.version(SCHEMA_VERSION).stores({
      trenches: 'id, code, area, backfilled',
      strata: 'id, trenchId, code, type, topDepth',
      artifacts: 'id, stratumId, code, category, date',
      relations: 'id, unitAId, unitBId, type, basis',
      refits: 'id, trenchId, status',
      meta: 'key'
    })
  }
}

export const db = new TrenchLogDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function syncAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function syncPut<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function syncDelete<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** Zustand vanilla store → Vue 响应式桥接 */
export function useStore<T extends object>(store: StoreApi<T>): T {
  const state = reactive({ ...store.getState() }) as T
  const unsubscribe = store.subscribe((next: T) => {
    Object.assign(state, next)
  })
  onUnmounted(() => unsubscribe())
  return state
}

/** 首次打开写入示例数据 */
export async function seedDemoData(): Promise<void> {
  const count = await db.trenches.count()
  if (count > 0) return

  const today = new Date().toISOString().slice(0, 10)

  await db.trenches.bulkPut([
    {
      id: 'tr_0501',
      code: 'T0501',
      area: 'Ⅱ区',
      size: '5×5 米',
      basePoint: 'N1200 / E3000',
      openLayer: '第①层',
      startDate: today,
      endDate: '',
      leader: '方铭',
      wallNote: '北壁、东壁保存较好；南壁被现代扰坑破坏',
      backfilled: false
    },
    {
      id: 'tr_0502',
      code: 'T0502',
      area: 'Ⅱ区',
      size: '5×5 米',
      basePoint: 'N1205 / E3000',
      openLayer: '第①层',
      startDate: today,
      endDate: today,
      leader: '方铭',
      wallNote: '四壁规整，西壁可见 H12 剖面',
      backfilled: true
    }
  ])

  await db.strata.bulkPut([
    {
      id: 'st_0501_l1',
      trenchId: 'tr_0501',
      code: 'L01',
      type: '地层',
      openLayer: '第①层',
      topDepth: 0,
      bottomDepth: 0.25,
      soil: '灰褐色砂质黏土，疏松',
      inclusions: ['陶片', '炭屑'],
      formation: '近现代耕土层',
      date: today,
      drawingNo: 'T0501-北壁-01'
    },
    {
      id: 'st_0501_l2',
      trenchId: 'tr_0501',
      code: 'L02',
      type: '地层',
      openLayer: '第②层',
      topDepth: 0.25,
      bottomDepth: 0.6,
      soil: '黄褐色黏土，致密',
      inclusions: ['陶片', '骨'],
      formation: '汉代文化层',
      date: today,
      drawingNo: 'T0501-北壁-02'
    },
    {
      id: 'st_0501_h12',
      trenchId: 'tr_0501',
      code: 'H12',
      type: '灰坑',
      openLayer: '第②层下',
      topDepth: 0.6,
      bottomDepth: 1.4,
      soil: '深灰褐土，含大量灰烬',
      inclusions: ['陶片', '骨', '炭屑'],
      formation: '生活垃圾坑',
      date: today,
      drawingNo: 'T0501-H12-平剖面'
    },
    {
      id: 'st_0502_l1',
      trenchId: 'tr_0502',
      code: 'L01',
      type: '地层',
      openLayer: '第①层',
      topDepth: 0,
      bottomDepth: 0.3,
      soil: '灰褐色砂质黏土',
      inclusions: ['陶片'],
      formation: '耕土层',
      date: today,
      drawingNo: 'T0502-西壁-01'
    }
  ])

  await db.artifacts.bulkPut([
    {
      id: 'af_001',
      stratumId: 'st_0501_l2',
      code: 'T0501②:1',
      category: '陶器',
      count: 3,
      completeness: '残片',
      x: 2.4,
      y: 1.8,
      z: 0.42,
      date: today,
      collector: '祁野',
      tempLocation: '工地临时柜 A-2'
    },
    {
      id: 'af_002',
      stratumId: 'st_0501_h12',
      code: 'T0501H12:1',
      category: '骨器',
      count: 1,
      completeness: '可复原',
      x: 3.1,
      y: 3.6,
      z: 1.05,
      date: today,
      collector: '祁野',
      tempLocation: '工地临时柜 A-3'
    },
    {
      id: 'af_003',
      stratumId: 'st_0501_h12',
      code: 'T0501H12:2',
      category: '陶器',
      count: 2,
      completeness: '残片',
      x: 2.9,
      y: 3.3,
      z: 1.12,
      date: today,
      collector: '祁野',
      tempLocation: '工地临时柜 A-2'
    }
  ])

  await db.relations.bulkPut([
    {
      id: 'rl_001',
      unitAId: 'st_0501_h12',
      type: '打破',
      unitBId: 'st_0501_l2',
      basis: '剖面观察',
      recorder: '方铭',
      note: 'H12 开口于第②层下，打破 L02'
    },
    {
      id: 'rl_002',
      unitAId: 'st_0501_l1',
      type: '叠压',
      unitBId: 'st_0501_l2',
      basis: '剖面观察',
      recorder: '方铭',
      note: 'L01 叠压 L02，界面清晰'
    }
  ])

  await db.refits.bulkPut([
    {
      id: 'rf_001',
      name: 'ZH-001',
      trenchId: 'tr_0501',
      members: [
        { artifactId: 'af_001', code: 'T0501②:1', stratumId: 'st_0501_l2', stratumCode: 'L02', category: '陶器', z: 0.42 },
        { artifactId: 'af_003', code: 'T0501H12:2', stratumId: 'st_0501_h12', stratumCode: 'H12', category: '陶器', z: 1.12 }
      ],
      basis: '',
      owner: '',
      note: '夹砂红陶，绳纹走向一致，疑似同一件陶罐腹片，散落于 L02 与 H12',
      status: '候选',
      createdAt: `${today} 09:30`,
      confirmedAt: '',
      revokedAt: '',
      revokeReason: ''
    }
  ])
}
