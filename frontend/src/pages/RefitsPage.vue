<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Artifact, RefitGroup, RefitMember, RefitStatus } from '@/types'
import { REFIT_STATUSES, missingMembers, sortMembersByDepth } from '@/types'
import TrenchTag from '@/components/common/TrenchTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { artifactStore } from '@/stores/artifactStore'
import { refitStore } from '@/stores/refitStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { uid } from '@/utils/id'

const refitState = useStore(refitStore)
const artifactState = useStore(artifactStore)
const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)

const filterTrenchId = ref('')
const filterStatus = ref<RefitStatus | ''>('')

const createTrenchId = ref('')
const selectedIds = ref<string[]>([])
const createForm = reactive({ name: '', note: '' })

const confirmVisible = ref(false)
const confirmTarget = ref<RefitGroup | null>(null)
const confirmForm = reactive({ basis: '', owner: '' })

const revokeVisible = ref(false)
const revokeTarget = ref<RefitGroup | null>(null)
const revokeReason = ref('')

/** 本地时间戳（YYYY-MM-DD HH:mm），用于建档/确认/撤销留痕 */
function nowStamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function stratumCodeOf(stratumId: string): string {
  return stratumState.strata.find((item) => item.id === stratumId)?.code ?? '未知单位'
}

function trenchOf(trenchId: string) {
  return trenchState.trenches.find((item) => item.id === trenchId) ?? null
}

/** 未撤销组对出土物的占用：artifactId → 组编号（同一件器物不能同时进入两个未撤销的组） */
const lockMap = computed(() => {
  const map = new Map<string, string>()
  for (const group of refitState.groups) {
    if (group.status === '已撤销') continue
    for (const member of group.members) map.set(member.artifactId, group.name)
  }
  return map
})

/** 当前建组探方内的出土物（可跨地层单位挑选） */
const trenchArtifacts = computed(() =>
  artifactState.artifacts.filter((item) => {
    const stratum = stratumState.strata.find((row) => row.id === item.stratumId)
    return stratum?.trenchId === createTrenchId.value
  })
)

const lockedInTrench = computed(() => trenchArtifacts.value.filter((item) => lockMap.value.has(item.id)).length)

/** 已选成员按出土深度从浅到深排列（即入组后的组内顺序） */
const selectedMembers = computed(() =>
  selectedIds.value
    .map((id) => artifactState.artifacts.find((item) => item.id === id))
    .filter((item): item is Artifact => Boolean(item))
    .sort((a, b) => a.z - b.z)
)

const visibleGroups = computed(() =>
  refitState.groups.filter((group) => {
    if (filterTrenchId.value && group.trenchId !== filterTrenchId.value) return false
    if (filterStatus.value && group.status !== filterStatus.value) return false
    return true
  })
)

const statusCount = computed(() => ({
  candidate: refitState.groups.filter((group) => group.status === '候选').length,
  confirmed: refitState.groups.filter((group) => group.status === '已确认').length,
  revoked: refitState.groups.filter((group) => group.status === '已撤销').length
}))

/** 存在缺件的未撤销组：成员记录已不在出土物编目 */
const missingGroups = computed(() =>
  refitState.groups.filter((group) => group.status !== '已撤销' && missingMembers(group, artifactState.artifacts).length > 0)
)

function missingOf(group: RefitGroup): RefitMember[] {
  return missingMembers(group, artifactState.artifacts)
}

function inCatalog(artifactId: string): boolean {
  return artifactState.artifacts.some((item) => item.id === artifactId)
}

function statusType(status: RefitStatus): 'warning' | 'success' | 'info' {
  if (status === '已确认') return 'success'
  if (status === '候选') return 'warning'
  return 'info'
}

function memberRowClass(param: { row: RefitMember }): string {
  return inCatalog(param.row.artifactId) ? '' : 'missing-row'
}

/** 下一个可用的组编号（含已撤销组，编号不可复用） */
function nextName(): string {
  let index = refitState.groups.length + 1
  let name = `ZH-${String(index).padStart(3, '0')}`
  while (refitState.groups.some((group) => group.name.toUpperCase() === name.toUpperCase())) {
    index += 1
    name = `ZH-${String(index).padStart(3, '0')}`
  }
  return name
}

watch(
  () => trenchState.trenches.length,
  () => {
    if (!createTrenchId.value && trenchState.trenches.length > 0) createTrenchId.value = trenchState.trenches[0].id
  },
  { immediate: true }
)

watch(createTrenchId, () => {
  selectedIds.value = []
})

watch(
  () => refitState.loaded,
  (loaded) => {
    if (loaded && !createForm.name) createForm.name = nextName()
  },
  { immediate: true }
)

async function create(): Promise<void> {
  if (!createTrenchId.value) {
    ElMessage.warning('请先选择所属探方')
    return
  }
  const name = createForm.name.trim()
  if (!name) {
    ElMessage.warning('请填写缀合组编号')
    return
  }
  if (refitState.groups.some((group) => group.name.toUpperCase() === name.toUpperCase())) {
    ElMessage.error(`缀合组编号「${name}」已存在（含已撤销组，编号不可复用）`)
    return
  }
  const members = selectedMembers.value
  if (members.length < 2) {
    ElMessage.warning('候选组至少需要两件出土物')
    return
  }
  const crossTrench = members.find((item) => {
    const stratum = stratumState.strata.find((row) => row.id === item.stratumId)
    return stratum?.trenchId !== createTrenchId.value
  })
  if (crossTrench) {
    ElMessage.error(`出土物 ${crossTrench.code} 不属于当前探方：缀合可跨地层单位，但不能跨探方`)
    return
  }
  const locked = members.find((item) => lockMap.value.has(item.id))
  if (locked) {
    ElMessage.error(`出土物 ${locked.code} 已在未撤销组「${lockMap.value.get(locked.id)}」中，不能重复入组`)
    return
  }
  const group: RefitGroup = {
    id: uid('rf'),
    name,
    trenchId: createTrenchId.value,
    members: members.map((item) => ({
      artifactId: item.id,
      code: item.code,
      stratumId: item.stratumId,
      stratumCode: stratumCodeOf(item.stratumId),
      category: item.category,
      z: item.z
    })),
    basis: '',
    owner: '',
    note: createForm.note.trim(),
    status: '候选',
    createdAt: nowStamp(),
    confirmedAt: '',
    revokedAt: '',
    revokeReason: ''
  }
  await refitStore.getState().save(group)
  ElMessage.success(`候选组 ${group.name} 已建立（${group.members.length} 件成员），确认前需填写依据与责任人`)
  selectedIds.value = []
  createForm.note = ''
  createForm.name = nextName()
}

function openConfirm(group: RefitGroup): void {
  confirmTarget.value = group
  confirmForm.basis = group.basis
  confirmForm.owner = group.owner
  confirmVisible.value = true
}

const confirmMissing = computed(() => (confirmTarget.value ? missingOf(confirmTarget.value) : []))

async function confirm(): Promise<void> {
  const group = confirmTarget.value
  if (!group) return
  if (confirmMissing.value.length > 0) {
    ElMessage.error(
      `组内缺件 ${confirmMissing.value.length} 件（${confirmMissing.value.map((item) => item.code).join('、')}），成员记录不在编目，无法确认`
    )
    return
  }
  if (!confirmForm.basis.trim()) {
    ElMessage.warning('请填写缀合依据')
    return
  }
  if (!confirmForm.owner.trim()) {
    ElMessage.warning('请填写责任人')
    return
  }
  await refitStore.getState().save({
    ...group,
    basis: confirmForm.basis.trim(),
    owner: confirmForm.owner.trim(),
    status: '已确认',
    confirmedAt: nowStamp()
  })
  ElMessage.success(`缀合组 ${group.name} 已确认`)
  confirmVisible.value = false
}

function openRevoke(group: RefitGroup): void {
  revokeTarget.value = group
  revokeReason.value = ''
  revokeVisible.value = true
}

async function revoke(): Promise<void> {
  const group = revokeTarget.value
  if (!group) return
  if (!revokeReason.value.trim()) {
    ElMessage.warning('撤销缀合组必须写明原因')
    return
  }
  await refitStore.getState().save({
    ...group,
    status: '已撤销',
    revokedAt: nowStamp(),
    revokeReason: revokeReason.value.trim()
  })
  ElMessage.success(`缀合组 ${group.name} 已撤销，成员已释放；旧组与成员记录继续可查`)
  revokeVisible.value = false
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">器物缀合工作台</h2>
        <p class="page-sub">
          把同一件器物散落各地层单位的残片串成候选组：可跨地层、不可跨探方；同一件器物只能进入一个未撤销的组；
          确认前需填写依据与责任人；成员记录不在编目即标缺件并挡住确认；撤销须写明原因，旧组与成员快照继续可查。
        </p>
      </div>
    </div>

    <el-alert
      v-if="missingGroups.length > 0"
      class="alert"
      type="error"
      :closable="false"
      show-icon
      :title="`${missingGroups.length} 个未撤销缀合组存在缺件：${missingGroups.map((group) => group.name).join('、')}（成员记录已不在出土物编目，确认会被挡住，请先核对编目）`"
    />

    <el-card shadow="never" class="create-card">
      <template #header>新建候选缀合组（先锁定探方，再跨地层单位挑残片）</template>
      <el-form label-width="100px">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="所属探方" required>
              <el-select v-model="createTrenchId" style="width: 100%">
                <el-option
                  v-for="trench in trenchState.trenches"
                  :key="trench.id"
                  :label="`${trench.area} · ${trench.code}`"
                  :value="trench.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="组编号" required>
              <el-input v-model="createForm.name" placeholder="如 ZH-001" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="备注">
              <el-input v-model="createForm.note" placeholder="纹饰、胎质、断口等线索" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="候选成员" required>
          <el-select
            v-model="selectedIds"
            multiple
            filterable
            collapse-tags
            :max-collapse-tags="4"
            placeholder="至少挑选两件，可跨地层单位，不可跨探方"
            style="width: 100%"
          >
            <el-option
              v-for="item in trenchArtifacts"
              :key="item.id"
              :value="item.id"
              :label="`${item.code}（${stratumCodeOf(item.stratumId)} · Z ${item.z} m）`"
              :disabled="lockMap.has(item.id)"
            >
              <span>{{ item.code }}</span>
              <span class="opt-muted">{{ stratumCodeOf(item.stratumId) }} · Z {{ item.z }} m · {{ item.category }} · {{ item.completeness }}</span>
              <span v-if="lockMap.has(item.id)" class="opt-lock">已被 {{ lockMap.get(item.id) }} 占用</span>
            </el-option>
          </el-select>
        </el-form-item>
        <div v-if="selectedMembers.length > 0" class="preview">
          <span class="preview-title">组内顺序（按出土深度从浅到深）：</span>
          <template v-for="(member, index) in selectedMembers" :key="member.id">
            <span class="chip">
              <b>{{ member.code }}</b>
              <em>{{ stratumCodeOf(member.stratumId) }} · {{ member.z }} m</em>
            </span>
            <span v-if="index < selectedMembers.length - 1" class="arrow">→</span>
          </template>
        </div>
        <div class="actions">
          <el-button type="primary" @click="create">建立候选组</el-button>
          <span class="muted">该探方共 {{ trenchArtifacts.length }} 件出土物 · 已被未撤销组占用 {{ lockedInTrench }} 件</span>
        </div>
      </el-form>
    </el-card>

    <div class="toolbar">
      <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 190px">
        <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px">
        <el-option v-for="item in REFIT_STATUSES" :key="item" :label="item" :value="item" />
      </el-select>
      <el-tag type="info" effect="plain">
        共 {{ visibleGroups.length }} 组 · 候选 {{ statusCount.candidate }} · 已确认 {{ statusCount.confirmed }} · 已撤销 {{ statusCount.revoked }}
      </el-tag>
    </div>

    <div class="group-list">
      <el-card v-for="group in visibleGroups" :key="group.id" shadow="never" class="group-card">
        <template #header>
          <div class="group-head">
            <span class="group-name mono">{{ group.name }}</span>
            <el-tag :type="statusType(group.status)" effect="dark" size="small">{{ group.status }}</el-tag>
            <el-tag v-if="missingOf(group).length > 0" type="danger" size="small">缺件 {{ missingOf(group).length }}</el-tag>
            <TrenchTag :trench="trenchOf(group.trenchId)" size="small" />
            <span class="muted">建于 {{ group.createdAt }}</span>
            <span class="head-ops">
              <el-button v-if="group.status === '候选'" type="primary" size="small" @click="openConfirm(group)">确认缀合</el-button>
              <el-button v-if="group.status !== '已撤销'" type="danger" size="small" plain @click="openRevoke(group)">撤销</el-button>
            </span>
          </div>
        </template>
        <el-table :data="sortMembersByDepth(group.members)" size="small" border :row-class-name="memberRowClass">
          <el-table-column type="index" label="序" width="46" />
          <el-table-column label="器物编号" width="150">
            <template #default="{ row }: { row: RefitMember }">
              <span class="mono">{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="stratumCode" label="地层单位" width="100" />
          <el-table-column prop="category" label="类别" width="90" />
          <el-table-column prop="z" label="出土深度 Z(m)" width="130" />
          <el-table-column label="编目状态" min-width="150">
            <template #default="{ row }: { row: RefitMember }">
              <el-tag v-if="inCatalog(row.artifactId)" type="success" size="small" effect="plain">在编目</el-tag>
              <el-tag v-else type="danger" size="small">缺件 · 记录不在编目</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="group-meta">
          <span>依据：{{ group.basis || '（确认前填写）' }}</span>
          <span>责任人：{{ group.owner || '（确认前填写）' }}</span>
          <span v-if="group.confirmedAt">确认时间：{{ group.confirmedAt }}</span>
          <span v-if="group.revokedAt" class="revoked">撤销：{{ group.revokedAt }} · 原因：{{ group.revokeReason }}</span>
          <span v-if="group.note">备注：{{ group.note }}</span>
        </div>
      </el-card>
      <p v-if="visibleGroups.length === 0" class="muted empty">暂无符合条件的缀合组</p>
    </div>

    <el-dialog v-model="confirmVisible" :title="`确认缀合组 ${confirmTarget?.name ?? ''}`" width="480px">
      <el-alert
        v-if="confirmMissing.length > 0"
        class="dialog-alert"
        type="error"
        :closable="false"
        show-icon
        :title="`缺件 ${confirmMissing.length} 件：${confirmMissing.map((item) => item.code).join('、')} 已不在出土物编目，无法确认`"
      />
      <el-form label-width="90px">
        <el-form-item label="缀合依据" required>
          <el-input v-model="confirmForm.basis" type="textarea" :rows="3" placeholder="如：断口可拼合、纹饰连续、胎釉一致" />
        </el-form-item>
        <el-form-item label="责任人" required>
          <el-input v-model="confirmForm.owner" placeholder="确认人姓名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" :disabled="confirmMissing.length > 0" @click="confirm">确认缀合</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="revokeVisible" :title="`撤销缀合组 ${revokeTarget?.name ?? ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="撤销原因" required>
          <el-input v-model="revokeReason" type="textarea" :rows="3" placeholder="如：复查后确认为两件不同器物" />
        </el-form-item>
      </el-form>
      <p class="muted">撤销后成员释放、可重新入组；旧组与成员快照继续保留可查。</p>
      <template #footer>
        <el-button @click="revokeVisible = false">取消</el-button>
        <el-button type="danger" @click="revoke">确认撤销</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.create-card {
  border-radius: 12px;
  margin-bottom: 16px;
}
.opt-muted {
  margin-left: 8px;
  font-size: 12px;
  color: #8a8073;
}
.opt-lock {
  margin-left: 8px;
  font-size: 12px;
  color: #c0392b;
}
.preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px 100px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f7f4ee;
}
.preview-title {
  font-size: 12px;
  color: #8a5a2b;
}
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #e0d5c2;
  font-size: 12px;
}
.chip em {
  font-style: normal;
  color: #8a8073;
}
.arrow {
  color: #a9762f;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 100px;
}
.group-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.group-card {
  border-radius: 12px;
}
.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.group-name {
  font-size: 15px;
  font-weight: 600;
}
.head-ops {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 10px;
  font-size: 12px;
  color: #6b6154;
}
.revoked {
  color: #c0392b;
}
.empty {
  padding: 12px 4px;
}
.dialog-alert {
  margin-bottom: 12px;
}
</style>
