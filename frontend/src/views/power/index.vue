<template>
  <section class="page" data-module="power">
    <header class="page-head">
      <div>
        <h2>洞内临时用电管理</h2>
        <p class="page-desc">按配电箱登记点检与停送电，漏电保护试验不通过直接进待整改；点检、停送电只能由持证电工操作。</p>
      </div>
      <div class="page-actions">
        <button v-if="session.canWriteLedger" class="btn primary" type="button" @click="openBoxForm">补录配电箱</button>
        <button class="btn" type="button" @click="exportRows">导出配电箱清单</button>
      </div>
    </header>

    <p v-if="!session.canWriteLedger" class="readonly-banner">
      当前是{{ session.roleLabel }}，台账只读，看到的与电工台账同源，改不动。
    </p>
    <p v-else-if="!session.isElectrician" class="readonly-banner">
      当前是{{ session.roleLabel }}，可补录配电箱；点检与停送电只能由持证电工操作。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="boxFormOpen" class="entry-panel" @submit.prevent="submitBox">
      <h3>补录配电箱（按安装位置照旧补录）</h3>
      <div class="panel-grid">
        <label class="filter-item">
          <span>配电箱编号</span>
          <input v-model="boxForm.配电箱编号" />
        </label>
        <label class="filter-item">
          <span>安装位置</span>
          <input v-model="boxForm.安装位置" placeholder="如 洞内K4+200" />
        </label>
        <label class="filter-item">
          <span>所属班组</span>
          <select v-model="boxForm.所属班组">
            <option>电工一班</option>
            <option>电工二班</option>
          </select>
        </label>
        <label class="filter-item">
          <span>责任单位</span>
          <input v-model="boxForm.责任单位" />
        </label>
        <label class="filter-item">
          <span>点检周期（天）</span>
          <input v-model.number="boxForm.点检周期" type="number" min="1" />
        </label>
        <label class="filter-item checkbox-item">
          <span>漏电保护台账</span>
          <span><input v-model="boxForm.漏电保护台账已建" type="checkbox" /> 已建立</span>
        </label>
      </div>
      <p class="panel-hint">存量补录缺漏电保护台账的别勾，台账上标「待补测」并排入点检计划，由持证电工实测补齐。</p>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="boxFormOpen = false">取消</button>
      </div>
    </form>

    <form v-if="inspectionTarget" class="entry-panel" @submit.prevent="submitInspection">
      <h3>登记点检：{{ inspectionTarget['配电箱编号'] }}（{{ inspectionTarget['安装位置'] }}）</h3>
      <div class="panel-grid">
        <label class="filter-item">
          <span>点检日期</span>
          <input v-model="inspectionForm.点检日期" type="date" />
        </label>
        <label class="filter-item">
          <span>漏电保护试验</span>
          <select v-model="inspectionForm.漏电保护试验">
            <option>通过</option>
            <option>不通过</option>
          </select>
        </label>
        <label v-if="inspectionForm.漏电保护试验 === '不通过'" class="filter-item">
          <span>未通过项（哪一项没过）</span>
          <select v-model="inspectionForm.未通过项">
            <option v-for="item in leakTestItems" :key="item">{{ item }}</option>
          </select>
        </label>
      </div>
      <p class="panel-hint">不通过的直接进待整改；点检人：{{ session.operator }}（证号 {{ session.certNo }}）。</p>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交点检</button>
        <button class="btn ghost" type="button" @click="inspectionTarget = null">取消</button>
      </div>
    </form>

    <form v-if="switchingTarget" class="entry-panel" @submit.prevent="submitSwitching">
      <h3>停送电登记：{{ switchingTarget['配电箱编号'] }}（{{ switchingTarget['安装位置'] }}）</h3>
      <p class="panel-hint">
        次序：停电 → 挂牌 → 作业 → 摘牌 → 送电。本次登记步骤：<strong>{{ nextStep }}</strong>
      </p>
      <label v-if="nextStep === '送电'" class="filter-item">
        <span>送电前确认（写进巡检台账隐患项清单）</span>
        <textarea v-model="switchingForm.送电前确认" rows="2" placeholder="如：漏电保护试验已通过，无未整改隐患"></textarea>
      </label>
      <div class="panel-actions">
        <button class="btn primary" type="submit">登记「{{ nextStep }}」</button>
        <button class="btn ghost" type="button" @click="switchingTarget = null">取消</button>
      </div>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th v-if="session.isElectrician">可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in boxes" :key="String(row.id)" :class="{ 'row-abnormal': row.status === '待整改' }">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td v-if="session.isElectrician" class="row-actions">
            <button class="link" type="button" @click="openInspection(row)">登记点检</button>
            <button class="link" type="button" @click="openSwitching(row)">停送电登记</button>
          </td>
        </tr>
        <tr v-if="!boxes.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无配电箱，可先补录配电箱</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">点检记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in inspectionColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in inspections" :key="String(row.id)">
          <td v-for="column in inspectionColumns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!inspections.length">
          <td :colspan="inspectionColumns.length + 1" class="empty-state">暂无点检记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">停送电记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in switchingColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in switchings" :key="String(row.id)">
          <td v-for="column in switchingColumns" :key="column">{{ row[column] || '—' }}</td>
        </tr>
        <tr v-if="!switchings.length">
          <td :colspan="switchingColumns.length" class="empty-state">暂无停送电记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ boxes.length }} 台配电箱 · 未整改配电箱数 {{ unrectifiedCount }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="infoMessage" class="ok-text">{{ infoMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  LEAK_TEST_ITEMS,
  countUnrectifiedBoxes,
  listBoxes,
  listInspections,
  listSwitching,
  nextSwitchStep,
  refreshDueBoxes,
  registerBox,
  registerInspection,
  registerSwitching,
  suggestBoxCode,
} from '@/api/power-service'
import { POWER_MODULE_KEY } from '@/data/modules'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const session = useSessionStore()

const columns = ["配电箱编号", "安装位置", "所属班组", "责任单位", "点检周期", "最近点检日期", "下次点检日期", "漏电保护试验", "未通过项"]
const statuses = ["正常", "到期待点检", "待整改", "已停用"]
const inspectionColumns = ["点检编号", "配电箱编号", "点检日期", "点检人", "电工证号", "漏电保护试验", "未通过项", "点检结论"]
const switchingColumns = ["操作编号", "配电箱编号", "操作步骤", "操作人", "所属班组", "操作时间", "送电前确认"]
const leakTestItems = LEAK_TEST_ITEMS

const boxes = ref<EntryRow[]>([])
const inspections = ref<EntryRow[]>([])
const switchings = ref<EntryRow[]>([])
const unrectifiedCount = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')

const boxFormOpen = ref(false)
const boxForm = ref({ 配电箱编号: '', 安装位置: '', 所属班组: '电工一班', 责任单位: '机电部', 点检周期: 30, 漏电保护台账已建: false })

const inspectionTarget = ref<EntryRow | null>(null)
const inspectionForm = ref({ 点检日期: '', 漏电保护试验: '通过' as '通过' | '不通过', 未通过项: LEAK_TEST_ITEMS[0] as string })

const switchingTarget = ref<EntryRow | null>(null)
const switchingForm = ref({ 送电前确认: '' })

const stats = computed(() => [
  { label: '在册配电箱', value: boxes.value.length },
  { label: '到期待点检', value: boxes.value.filter((row) => row.status === '到期待点检').length },
  { label: '待整改配电箱', value: unrectifiedCount.value },
  { label: '已停用', value: boxes.value.filter((row) => row.status === '已停用').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: boxes.value.filter((row) => String(row.status) === status).length })),
)

const nextStep = computed(() =>
  switchingTarget.value ? nextSwitchStep(String(switchingTarget.value['配电箱编号'])) : '停电',
)

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function openBoxForm() {
  boxForm.value = { 配电箱编号: suggestBoxCode(), 安装位置: '', 所属班组: '电工一班', 责任单位: '机电部', 点检周期: 30, 漏电保护台账已建: false }
  boxFormOpen.value = true
  inspectionTarget.value = null
  switchingTarget.value = null
}

function openInspection(row: EntryRow) {
  inspectionTarget.value = row
  inspectionForm.value = { 点检日期: today(), 漏电保护试验: '通过', 未通过项: LEAK_TEST_ITEMS[0] as string }
  switchingTarget.value = null
  boxFormOpen.value = false
}

function openSwitching(row: EntryRow) {
  switchingTarget.value = row
  switchingForm.value = { 送电前确认: '' }
  inspectionTarget.value = null
  boxFormOpen.value = false
}

function report(result: { ok: boolean; message: string }) {
  if (result.ok) {
    infoMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    infoMessage.value = ''
  }
}

function submitBox() {
  const result = registerBox(boxForm.value)
  report(result)
  if (result.ok) {
    boxFormOpen.value = false
  }
  reload()
}

function submitInspection() {
  if (!inspectionTarget.value) {
    return
  }
  const result = registerInspection({ boxId: Number(inspectionTarget.value.id), ...inspectionForm.value })
  report(result)
  if (result.ok) {
    inspectionTarget.value = null
  }
  reload()
}

function submitSwitching() {
  if (!switchingTarget.value) {
    return
  }
  const result = registerSwitching({
    boxId: Number(switchingTarget.value.id),
    step: nextStep.value,
    送电前确认: switchingForm.value.送电前确认,
  })
  report(result)
  if (result.ok) {
    switchingTarget.value = null
  }
  reload()
}

function exportRows() {
  downloadEntries(POWER_MODULE_KEY)
}

function reload() {
  boxes.value = refreshDueBoxes()
  inspections.value = listInspections()
  switchings.value = listSwitching()
  unrectifiedCount.value = countUnrectifiedBoxes()
}

onMounted(reload)
</script>

<style scoped>
.readonly-banner {
  background: #eef2f7;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--muted);
}
.entry-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.entry-panel h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.panel-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.panel-grid .filter-item span:first-child {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.checkbox-item input {
  margin-right: 4px;
}
.panel-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 0;
}
.panel-actions {
  display: flex;
  gap: 8px;
}
.section-title {
  font-size: 14px;
  margin: 16px 0 8px;
}
.row-abnormal td {
  background: #fef3f2;
}
.ok-text {
  color: #067647;
}
textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
</style>
