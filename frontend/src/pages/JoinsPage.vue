<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Artifact, JoinGroup, JoinMember, JoinStatus } from '@/types'
import { JOIN_BASES, nextJoinCode, occupiedArtifactMap, resolveGroup, sortMembersByDepth } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { artifactStore } from '@/stores/artifactStore'
import { joinGroupStore } from '@/stores/joinGroupStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { uid } from '@/utils/id'

const trenchState = useStore(trenchStore)
const stratumState = useStore(stratumStore)
const artifactState = useStore(artifactStore)
const joinState = useStore(joinGroupStore)

const filterTrenchId = ref('')
const filterStatus = ref<JoinStatus | ''>('')
const editingId = ref<string | null>(null)

const form = reactive({
  trenchId: '',
  basis: '',
  responsible: '',
  note: '',
  members: [] as JoinMember[]
})

/** 手工登记的、尚未进入编目的残片 */
const missingDraft = reactive({ code: '', z: null as number | null, stratumId: '' })
const poolSelectId = ref('')

const trenchStrata = computed(() => stratumState.strata.filter((item) => item.trenchId === form.trenchId))

watch(
  () => trenchState.trenches.length,
  () => {
    if (!form.trenchId && trenchState.trenches.length > 0) {
      form.trenchId = trenchState.trenches[0].id
    }
  },
  { immediate: true }
)

// 新建时切换探方：成员必须全部来自同一探方，清空重选
let suppressTrenchWatch = false
watch(
  () => form.trenchId,
  (next, prev) => {
    if (suppressTrenchWatch) return
    if (!editingId.value && prev && next !== prev) {
      form.members.splice(0)
      missingDraft.stratumId = ''
      poolSelectId.value = ''
    }
  }
)

function stratumOfId(stratumId: string) {
  return stratumState.strata.find((item) => item.id === stratumId)
}

function trenchLabel(trenchId: string): string {
  const trench = trenchState.trenches.find((item) => item.id === trenchId)
  return trench ? `${trench.area} · ${trench.code}` : '未知探方'
}

/** 用当前编目解析每个组 */
const resolvedMap = computed(() => {
  const map = new Map<string, ReturnType<typeof resolveGroup>>()
  for (const group of joinState.groups) {
    map.set(group.id, resolveGroup(group, artifactState.artifacts, stratumState.strata))
  }
  return map
})

/** 未撤销组对在编器物的占用（编辑中的组自身排除） */
const occupiedMap = computed(() => occupiedArtifactMap(joinState.groups, editingId.value ?? undefined))

/** 当前探方可选的在编出土物（已被其他未撤销组占用的会在选项中标出并禁用） */
const artifactPool = computed(() => {
  const stratumIds = new Set(trenchStrata.value.map((item) => item.id))
  return artifactState.artifacts
    .filter((item) => stratumIds.has(item.stratumId))
    .map((artifact) => {
      const stratum = stratumOfId(artifact.stratumId)
      return { artifact, stratum, occupiedBy: occupiedMap.value.get(artifact.id) ?? '' }
    })
})

const draftResolved = computed(() =>
  resolveGroup(
    {
      id: 'draft',
      code: '',
      trenchId: form.trenchId,
      status: '候选',
      basis: form.basis,
      responsible: form.responsible,
      note: form.note,
      members: form.members,
      createdAt: '',
      confirmedAt: '',
      revokedAt: '',
      revokeReason: ''
    } satisfies JoinGroup,
    artifactState.artifacts,
    stratumState.strata
  )
)

watch(
  () => form.trenchId,
  () => {
    if (!trenchStrata.value.some((item) => item.id === missingDraft.stratumId)) {
      missingDraft.stratumId = ''
    }
  }
)

function addCatalogMember(): void {
  if (!poolSelectId.value) {
    ElMessage.warning('请先选择一件出土物')
    return
  }
  const hit = artifactPool.value.find((item) => item.artifact.id === poolSelectId.value)
  if (!hit) return
  if (hit.occupiedBy) {
    ElMessage.error(`「${hit.artifact.code}」已在未撤销组 ${hit.occupiedBy} 中，同一件器物不能重复缀合`)
    return
  }
  if (form.members.some((member) => member.artifactId === hit.artifact.id)) {
    ElMessage.warning('该出土物已在本组中')
    return
  }
  const member: JoinMember = {
    artifactId: hit.artifact.id,
    code: hit.artifact.code,
    category: hit.artifact.category,
    z: hit.artifact.z,
    stratumCode: hit.stratum?.code ?? '',
    addedAt: new Date().toISOString(),
    missing: false
  }
  form.members.push(member)
  poolSelectId.value = ''
}

function addMissingMember(): void {
  const code = missingDraft.code.trim()
  if (!code) {
    ElMessage.warning('请填写残片的器物编号或临时标识')
    return
  }
  if (form.members.some((member) => member.code === code)) {
    ElMessage.warning('该残片已在本组中')
    return
  }
  const stratum = stratumOfId(missingDraft.stratumId)
  const member: JoinMember = {
    artifactId: '',
    code,
    category: '陶器',
    z: missingDraft.z,
    stratumCode: stratum?.code ?? '',
    addedAt: new Date().toISOString(),
    missing: true
  }
  form.members.push(member)
  missingDraft.code = ''
  missingDraft.z = null
}

function removeMember(index: number): void {
  form.members.splice(index, 1)
}

/** 保存候选前的统一校验，返回错误信息（空串表示通过） */
function validateBuilder(): string {
  if (!form.trenchId) return '请选择探方'
  const catalogCount = draftResolved.value.members.filter((member) => !member.resolvedMissing).length
  if (catalogCount < 2) return '候选组至少要从出土物编目中选择两件器物'
  for (const member of draftResolved.value.members) {
    if (member.artifact && member.stratum && member.stratum.trenchId !== form.trenchId) {
      return `「${member.code}」当前所属探方与本组探方不一致，缀合不能跨探方`
    }
  }
  return ''
}

/** 确认前额外校验：依据、责任人、缺件 */
function validateConfirm(): string {
  const base = validateBuilder()
  if (base) return base
  if (draftResolved.value.hasMissing) return '组内存在缺件（成员记录不在编目），请补入编目或移出后再确认'
  if (!form.basis.trim()) return '确认前必须填写缀合依据'
  if (!form.responsible.trim()) return '确认前必须填写责任人'
  return ''
}

/** 以当前编目数据重建成员快照，并按出土深度从浅到深排列 */
function rebuildMembers(members: JoinMember[], trenchId: string): JoinMember[] {
  const resolved = resolveGroup(
    {
      id: 'draft',
      code: '',
      trenchId,
      status: '候选',
      basis: '',
      responsible: '',
      note: '',
      members,
      createdAt: '',
      confirmedAt: '',
      revokedAt: '',
      revokeReason: ''
    },
    artifactState.artifacts,
    stratumState.strata
  )
  return sortMembersByDepth(
    resolved.members.map<JoinMember>((member) => ({
      artifactId: member.resolvedMissing ? member.artifactId : member.artifact!.id,
      code: member.code,
      category: member.category,
      z: member.depth,
      stratumCode: member.stratumCode,
      addedAt: member.addedAt,
      missing: member.resolvedMissing
    }))
  )
}

async function submit(asConfirm: boolean): Promise<void> {
  const error = asConfirm ? validateConfirm() : validateBuilder()
  if (error) {
    ElMessage.error(error)
    return
  }

  const members = rebuildMembers(form.members, form.trenchId)
  const now = new Date().toISOString()
  const existing = editingId.value ? joinState.groups.find((item) => item.id === editingId.value) : undefined
  const row: JoinGroup = {
    id: editingId.value ?? uid('jg'),
    code: existing?.code ?? nextJoinCode(joinState.groups),
    trenchId: form.trenchId,
    status: asConfirm ? '已确认' : '候选',
    basis: form.basis.trim(),
    responsible: form.responsible.trim(),
    note: form.note.trim(),
    members,
    createdAt: existing?.createdAt ?? now,
    confirmedAt: asConfirm ? existing?.confirmedAt || now : '',
    revokedAt: '',
    revokeReason: ''
  }
  await joinGroupStore.getState().save(row)
  ElMessage.success(asConfirm ? `缀合组 ${row.code} 已确认` : `候选组 ${row.code} 已保存`)
  resetForm()
}

function editGroup(group: JoinGroup): void {
  editingId.value = group.id
  suppressTrenchWatch = true
  form.trenchId = group.trenchId
  form.basis = group.basis
  form.responsible = group.responsible
  form.note = group.note
  form.members = group.members.map((member) => ({ ...member }))
  void Promise.resolve().then(() => {
    suppressTrenchWatch = false
  })
}

function resetForm(): void {
  editingId.value = null
  form.basis = ''
  form.responsible = ''
  form.note = ''
  form.members.splice(0)
  missingDraft.code = ''
  missingDraft.z = null
  poolSelectId.value = ''
}

async function confirmGroup(group: JoinGroup): Promise<void> {
  const resolved = resolvedMap.value.get(group.id)
  if (!resolved) return
  if (resolved.hasMissing) {
    ElMessage.error(`组 ${group.code} 存在缺件，无法确认`)
    return
  }
  if (!group.basis.trim() || !group.responsible.trim()) {
    ElMessage.warning('请先编辑该候选组，补齐缀合依据与责任人')
    return
  }
  await ElMessageBox.confirm(
    `确认缀合组 ${group.code}？确认后组内 ${group.members.length} 件器物将被该组占用。`,
    '确认缀合',
    { type: 'info', confirmButtonText: '确认缀合', cancelButtonText: '再核对一下' }
  )
  const members = rebuildMembers(group.members, group.trenchId)
  await joinGroupStore.getState().confirm(group.id, members)
  ElMessage.success(`缀合组 ${group.code} 已确认`)
}

async function revokeGroup(group: JoinGroup): Promise<void> {
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(`请填写撤销缀合组 ${group.code} 的原因（必填）`, '撤销缀合', {
      type: 'warning',
      confirmButtonText: '确认撤销',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '如 复检发现陶质不一致、与 ZH-007 重复缀合等',
      inputValidator: (value: string) => (value.trim() ? true : '撤销必须写明原因')
    })
    reason = result.value
  } catch {
    return
  }
  await joinGroupStore.getState().revoke(group.id, reason)
  if (editingId.value === group.id) resetForm()
  ElMessage.success(`缀合组 ${group.code} 已撤销，旧组与成员记录保留可查`)
}

async function deleteCandidate(group: JoinGroup): Promise<void> {
  await ElMessageBox.confirm(`确认删除候选组 ${group.code}？该操作不影响出土物编目。`, '删除候选组', {
    type: 'warning'
  })
  await joinGroupStore.getState().remove(group.id)
  if (editingId.value === group.id) resetForm()
  ElMessage.success('候选组已删除')
}

const visibleGroups = computed(() =>
  joinState.groups
    .filter((group) => !filterTrenchId.value || group.trenchId === filterTrenchId.value)
    .filter((group) => !filterStatus.value || group.status === filterStatus.value)
    .slice()
    .reverse()
)

function day(iso: string): string {
  return iso ? iso.slice(0, 10) : '—'
}

function statusTagType(status: JoinStatus): 'warning' | 'success' | 'info' {
  if (status === '已确认') return 'success'
  if (status === '候选') return 'warning'
  return 'info'
}

const poolStratum = (artifact: Artifact) => stratumOfId(artifact.stratumId)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">器物缀合工作台</h2>
        <p class="page-sub">
          从出土物编目中挑选残片组成候选组：可跨地层单位、不能跨探方；同一件器物不能同时进入两个未撤销的组。确认前须填写依据与责任人，组内按出土深度由浅入深排列；成员记录不在编目时标为缺件并阻止确认。撤销须写明原因，旧组与成员记录始终保留可查。
        </p>
      </div>
    </div>

    <div class="layout">
      <!-- 左：候选组编辑器 -->
      <el-card shadow="never" class="builder-card">
        <template #header>
          <div class="card-head">
            <span>{{ editingId ? '编辑候选组' : '新建缀合候选组' }}</span>
            <el-tag v-if="editingId" type="warning" size="small">仅候选组可编辑</el-tag>
          </div>
        </template>

        <el-form label-width="88px" size="small">
          <el-form-item label="探方" required>
            <el-select
              v-model="form.trenchId"
              style="width: 100%"
              :disabled="!!editingId"
              placeholder="选择探方（全组仅限同一探方）"
            >
              <el-option
                v-for="trench in trenchState.trenches"
                :key="trench.id"
                :label="`${trench.area} · ${trench.code}`"
                :value="trench.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="在编器物">
            <div class="pool-row">
              <el-select
                v-model="poolSelectId"
                filterable
                clearable
                placeholder="从该探方的出土物中选择加入"
                style="flex: 1"
              >
                <el-option
                  v-for="item in artifactPool"
                  :key="item.artifact.id"
                  :label="`${item.artifact.code}（${poolStratum(item.artifact)?.code ?? '?'} · ${item.artifact.z} m）`"
                  :value="item.artifact.id"
                  :disabled="!!item.occupiedBy"
                >
                  <span class="mono">{{ item.artifact.code }}</span>
                  <span class="muted">
                    （{{ item.stratum?.code ?? '未知单位' }} · {{ item.artifact.category }} · {{ item.artifact.z }} m）
                  </span>
                  <el-tag v-if="item.occupiedBy" size="small" type="danger" effect="plain" class="occupy-tag">
                    已在 {{ item.occupiedBy }}
                  </el-tag>
                </el-option>
              </el-select>
              <el-button type="primary" plain @click="addCatalogMember">加入</el-button>
            </div>
          </el-form-item>

          <el-form-item label="未编目残片">
            <div class="missing-row">
              <el-input
                v-model="missingDraft.code"
                placeholder="编号/临时标识，如 T0501H12:口沿"
                style="width: 200px"
              />
              <el-select v-model="missingDraft.stratumId" placeholder="所在单位" clearable style="width: 110px">
                <el-option v-for="s in trenchStrata" :key="s.id" :label="s.code" :value="s.id" />
              </el-select>
              <el-input-number
                v-model="missingDraft.z"
                :min="0"
                :max="10"
                :step="0.01"
                :precision="2"
                :controls="false"
                placeholder="深度m"
                style="width: 100px"
              />
              <el-button type="warning" plain @click="addMissingMember">按缺件登记</el-button>
            </div>
          </el-form-item>

          <el-form-item label="组成员">
            <el-table :data="draftResolved.members" size="small" border class="member-table" row-key="code">
              <el-table-column label="序" width="46" type="index" align="center" />
              <el-table-column label="器物编号" min-width="170">
                <template #default="{ row }">
                  <span class="mono">{{ row.code }}</span>
                  <el-tag v-if="row.resolvedMissing" size="small" type="danger" effect="dark" class="ml">缺件</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="72">
                <template #default="{ row }">{{ row.stratumCode || '—' }}</template>
              </el-table-column>
              <el-table-column label="深度(m)" width="90">
                <template #default="{ row }">{{ row.depth ?? '未知' }}</template>
              </el-table-column>
              <el-table-column label="类别" width="76" prop="category" />
              <el-table-column label="操作" width="72" align="center">
                <template #default="{ $index }">
                  <el-button link type="danger" size="small" @click="removeMember($index)">移出</el-button>
                </template>
              </el-table-column>
              <template #empty>尚未加入成员，至少选择两件在编出土物</template>
            </el-table>
          </el-form-item>

          <el-alert
            v-if="draftResolved.hasMissing"
            title="组内存在缺件：成员记录不在出土物编目中。缺件可随候选组保存备查，但在补齐编目前无法确认缀合。"
            type="error"
            :closable="false"
            show-icon
            class="block-alert"
          />
          <el-alert
            v-else-if="draftResolved.members.length > 0"
            title="成员均可在编目中核验，成员将按出土深度由浅入深排序保存。"
            type="success"
            :closable="false"
            show-icon
            class="block-alert"
          />

          <el-form-item label="缀合依据" class="mt">
            <el-select
              v-model="form.basis"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
              placeholder="确认前必填，如 茬口吻合、陶质陶色一致"
            >
              <el-option v-for="item in JOIN_BASES" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="责任人">
            <el-input v-model="form.responsible" placeholder="确认前必填" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.note" type="textarea" :rows="2" placeholder="如 残片分属不同地层单位，整理时串并" />
          </el-form-item>

          <div class="actions">
            <el-button type="primary" @click="submit(true)">确认缀合</el-button>
            <el-button @click="submit(false)">{{ editingId ? '保存修改' : '存为候选' }}</el-button>
            <el-button v-if="editingId" @click="resetForm">取消编辑</el-button>
          </div>
        </el-form>
      </el-card>

      <!-- 右：缀合组清单 -->
      <div class="list-side">
        <div class="toolbar list-toolbar">
          <el-select v-model="filterTrenchId" placeholder="全部探方" clearable size="small" style="width: 160px">
            <el-option
              v-for="trench in trenchState.trenches"
              :key="trench.id"
              :label="`${trench.area} · ${trench.code}`"
              :value="trench.id"
            />
          </el-select>
          <el-select v-model="filterStatus" placeholder="全部状态" clearable size="small" style="width: 120px">
            <el-option v-for="s in ['候选', '已确认', '已撤销']" :key="s" :label="s" :value="s" />
          </el-select>
          <el-tag type="info" effect="plain" size="small">
            候选 {{ joinState.groups.filter((g) => g.status === '候选').length }} · 已确认
            {{ joinState.groups.filter((g) => g.status === '已确认').length }} · 已撤销
            {{ joinState.groups.filter((g) => g.status === '已撤销').length }}
          </el-tag>
        </div>

        <el-card v-for="group in visibleGroups" :key="group.id" shadow="never" class="group-card">
          <template #header>
            <div class="card-head">
              <div class="group-title">
                <span class="mono group-code">{{ group.code }}</span>
                <el-tag :type="statusTagType(group.status)" size="small" effect="dark">{{ group.status }}</el-tag>
                <span class="muted">{{ trenchLabel(group.trenchId) }} · 建档 {{ day(group.createdAt) }}</span>
              </div>
              <span v-if="!editingId || editingId !== group.id" class="ops">
                <el-button
                  v-if="group.status === '候选'"
                  link
                  type="primary"
                  size="small"
                  @click="editGroup(group)"
                >
                  编辑
                </el-button>
                <el-button
                  v-if="group.status === '候选'"
                  link
                  type="success"
                  size="small"
                  @click="confirmGroup(group)"
                >
                  确认
                </el-button>
                <el-button v-if="group.status === '候选'" link type="danger" size="small" @click="deleteCandidate(group)">
                  删除
                </el-button>
                <el-button v-if="group.status === '已确认'" link type="warning" size="small" @click="revokeGroup(group)">
                  撤销
                </el-button>
              </span>
              <el-tag v-else type="warning" size="small">编辑中…</el-tag>
            </div>
          </template>

          <el-table :data="resolvedMap.get(group.id)?.members ?? []" size="small" border class="member-table">
            <el-table-column label="序" width="46" type="index" align="center" />
            <el-table-column label="器物编号（浅 → 深）" min-width="180">
              <template #default="{ row }">
                <span class="mono">{{ row.code }}</span>
                <el-tag v-if="row.resolvedMissing" size="small" type="danger" effect="dark" class="ml">
                  缺件
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="单位" width="72">
              <template #default="{ row }">{{ row.stratumCode || '—' }}</template>
            </el-table-column>
            <el-table-column label="深度(m)" width="90">
              <template #default="{ row }">{{ row.depth ?? '未知' }}</template>
            </el-table-column>
            <el-table-column label="类别" width="76" prop="category" />
            <el-table-column label="核验" min-width="120">
              <template #default="{ row }">
                <span v-if="row.resolvedMissing" class="missing-text">{{ row.missingReason }}</span>
                <el-tag v-else size="small" type="success" effect="plain">编目可查</el-tag>
              </template>
            </el-table-column>
          </el-table>

          <el-alert
            v-if="resolvedMap.get(group.id)?.hasMissing"
            :title="`${group.code} 含缺件（成员记录不在编目），${group.status === '已确认' ? '现状已冻结' : '确认被阻止'}`"
            type="error"
            :closable="false"
            show-icon
            class="block-alert"
          />
          <el-alert
            v-if="resolvedMap.get(group.id)?.crossTrench"
            title="检测到成员当前所属探方与本组不一致（串方），请核对"
            type="warning"
            :closable="false"
            show-icon
            class="block-alert"
          />

          <div class="meta-line">
            <span><b>依据：</b>{{ group.basis || '（未填）' }}</span>
            <span><b>责任人：</b>{{ group.responsible || '（未填）' }}</span>
            <span v-if="group.confirmedAt"><b>确认：</b>{{ day(group.confirmedAt) }}</span>
          </div>
          <div v-if="group.note" class="meta-note muted">备注：{{ group.note }}</div>

          <el-alert
            v-if="group.status === '已撤销'"
            :title="`已于 ${day(group.revokedAt)} 撤销 · 原因：${group.revokeReason}（旧组与成员记录保留可查）`"
            type="info"
            :closable="false"
            show-icon
            class="block-alert"
          />
        </el-card>

        <el-empty v-if="visibleGroups.length === 0" description="暂无符合条件的缀合组" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.builder-card {
  flex: 1 1 460px;
  min-width: 420px;
  border-radius: 12px;
}
.list-side {
  flex: 1 1 420px;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list-toolbar {
  margin-bottom: 0;
  padding: 10px 12px;
  border-radius: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.group-code {
  font-weight: 700;
  font-size: 14px;
}
.pool-row,
.missing-row {
  display: flex;
  gap: 8px;
  width: 100%;
  flex-wrap: wrap;
}
.occupy-tag {
  margin-left: 8px;
}
.member-table {
  width: 100%;
}
.ml {
  margin-left: 6px;
}
.missing-text {
  color: #c45656;
  font-size: 12px;
}
.block-alert {
  margin-top: 8px;
}
.mt {
  margin-top: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  padding-left: 88px;
  flex-wrap: wrap;
}
.ops {
  white-space: nowrap;
}
.group-card {
  border-radius: 12px;
}
.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 10px;
  font-size: 12px;
  color: #5c452b;
}
.meta-note {
  margin-top: 4px;
  line-height: 1.6;
}
</style>
