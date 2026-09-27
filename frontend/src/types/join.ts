import type { Artifact } from './artifact'
import type { Stratum } from './stratum'

/** 缀合组状态：候选 → 已确认 →（撤销）→ 已撤销 */
export const JOIN_STATUSES = ['候选', '已确认', '已撤销'] as const
export type JoinStatus = (typeof JOIN_STATUSES)[number]

/** 常用缀合依据（可在选择器中自行补录） */
export const JOIN_BASES = [
  '茬口吻合',
  '陶质陶色一致',
  '纹饰衔接',
  '形制可复原',
  '出土位置邻近',
  '编号关联'
] as const

/** 缀合组成员：在编目器物以 artifactId 关联，不在编目的残片以 missing 标记为缺件 */
export interface JoinMember {
  /** 出土物 ID；空串表示该残片尚未进入编目（缺件） */
  artifactId: string
  /** 器物编号（加入时的快照） */
  code: string
  /** 类别快照 */
  category: string
  /** 出土深度快照（米）；缺件且深度未知时为 null */
  z: number | null
  /** 地层单位号快照 */
  stratumCode: string
  addedAt: string
  /** 是否为不在编目的缺件 */
  missing: boolean
}

/** JoinGroup 器物缀合组 */
export interface JoinGroup {
  id: string
  /** 缀合组号，如 ZH-001 */
  code: string
  /** 只能在同一探方内缀合（可跨地层单位） */
  trenchId: string
  status: JoinStatus
  /** 缀合依据（确认前必填） */
  basis: string
  /** 责任人（确认前必填） */
  responsible: string
  note: string
  /** 组内按出土深度从浅到深排列保存 */
  members: JoinMember[]
  createdAt: string
  confirmedAt: string
  revokedAt: string
  /** 撤销原因 */
  revokeReason: string
}

/** 结合当前编目解析后的成员视图 */
export interface ResolvedMember extends JoinMember {
  /** 当前编目中的出土物（缺件时为 undefined） */
  artifact?: Artifact
  stratum?: Stratum
  /** 以编目当前深度为准的排序深度 */
  depth: number | null
  /** 解析后是否缺件（手工缺件或原记录已不在编目） */
  resolvedMissing: boolean
  missingReason: string
}

export interface ResolvedGroup {
  members: ResolvedMember[]
  hasMissing: boolean
  /** 是否有成员的当前编目记录已落到其他探方 */
  crossTrench: boolean
}

/** 未撤销的组仍占用器物 */
export function isGroupActive(group: JoinGroup): boolean {
  return group.status !== '已撤销'
}

/** 出土深度从浅到深（z 升序），深度未知的缺件排在最后 */
export function sortMembersByDepth<T extends Pick<JoinMember, 'z' | 'code'>>(members: T[]): T[] {
  return [...members].sort((a, b) => {
    if (a.z === null && b.z === null) return a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true })
    if (a.z === null) return 1
    if (b.z === null) return -1
    if (a.z !== b.z) return a.z - b.z
    return a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true })
  })
}

/** 用当前编目数据解析组内成员：补齐最新编号/深度，并标出缺件与串方问题 */
export function resolveGroup(group: JoinGroup, artifacts: Artifact[], strata: Stratum[]): ResolvedGroup {
  const resolved: ResolvedMember[] = group.members.map((member) => {
    if (member.missing || !member.artifactId) {
      return { ...member, depth: member.z, resolvedMissing: true, missingReason: '编目中查无此记录' }
    }
    const artifact = artifacts.find((item) => item.id === member.artifactId)
    if (!artifact) {
      return { ...member, depth: member.z, resolvedMissing: true, missingReason: '原出土物记录已不在编目' }
    }
    const stratum = strata.find((item) => item.id === artifact.stratumId)
    return {
      ...member,
      artifact,
      stratum,
      code: artifact.code,
      category: artifact.category,
      depth: artifact.z,
      stratumCode: stratum?.code ?? member.stratumCode,
      resolvedMissing: false,
      missingReason: ''
    }
  })
  const ordered = sortMembersByDepth(resolved)
  const hasMissing = ordered.some((member) => member.resolvedMissing)
  const crossTrench = ordered.some(
    (member) => member.artifact && member.stratum && member.stratum.trenchId !== group.trenchId
  )
  return { members: ordered, hasMissing, crossTrench }
}

/** 未撤销组对在编器物的占用表：artifactId → 缀合组号 */
export function occupiedArtifactMap(groups: JoinGroup[], excludeGroupId?: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const group of groups) {
    if (!isGroupActive(group) || group.id === excludeGroupId) continue
    for (const member of group.members) {
      if (member.artifactId && !map.has(member.artifactId)) map.set(member.artifactId, group.code)
    }
  }
  return map
}

/** 生成下一个缀合组号 ZH-001、ZH-002… */
export function nextJoinCode(groups: JoinGroup[]): string {
  let max = 0
  for (const group of groups) {
    const match = /^ZH-(\d+)$/i.exec(group.code)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `ZH-${String(max + 1).padStart(3, '0')}`
}
