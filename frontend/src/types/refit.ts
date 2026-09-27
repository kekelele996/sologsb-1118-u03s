import type { Artifact, ArtifactCategory } from './artifact'

/** 缀合组状态：候选 → 已确认 → 已撤销（撤销后成员释放，旧组保留可查） */
export const REFIT_STATUSES = ['候选', '已确认', '已撤销'] as const
export type RefitStatus = (typeof REFIT_STATUSES)[number]

/** 缀合组成员快照：入组时留存编目信息，成员日后从编目删除仍可查、可标缺件 */
export interface RefitMember {
  /** 出土物 id（指向编目记录） */
  artifactId: string
  /** 器物编号快照 */
  code: string
  /** 所属地层单位 id 快照 */
  stratumId: string
  /** 地层单位号快照 */
  stratumCode: string
  category: ArtifactCategory
  /** 出土深度 Z（距地表深度，米）快照 */
  z: number
}

/** RefitGroup 器物缀合组 */
export interface RefitGroup {
  id: string
  /** 缀合组编号，如 ZH-001 */
  name: string
  /** 所属探方：成员可跨地层单位，但必须同属一个探方 */
  trenchId: string
  /** 组内成员（按出土深度从浅到深排列） */
  members: RefitMember[]
  /** 缀合依据（确认前必填） */
  basis: string
  /** 责任人（确认前必填） */
  owner: string
  note: string
  status: RefitStatus
  createdAt: string
  confirmedAt: string
  revokedAt: string
  /** 撤销原因（撤销时必填） */
  revokeReason: string
}

/** 组内成员按出土深度从浅到深排列 */
export function sortMembersByDepth(members: RefitMember[]): RefitMember[] {
  return [...members].sort((a, b) => a.z - b.z)
}

/** 缺件成员：成员记录已不在出土物编目里 */
export function missingMembers(group: RefitGroup, artifacts: Artifact[]): RefitMember[] {
  return group.members.filter((member) => !artifacts.some((item) => item.id === member.artifactId))
}

/** 占用某件出土物的未撤销组（无则返回 null）：同一件器物不能同时进入两个未撤销的组 */
export function findActiveGroupOf(groups: RefitGroup[], artifactId: string, excludeId = ''): RefitGroup | null {
  return (
    groups.find(
      (group) =>
        group.id !== excludeId &&
        group.status !== '已撤销' &&
        group.members.some((member) => member.artifactId === artifactId)
    ) ?? null
  )
}
