<template>
  <section class="page" data-module="power">
    <header class="page-head">
      <div>
        <h2>洞内临时用电管理</h2>
        <p class="page-desc">
          按配电箱登记点检与漏电保护试验；停送电按停电→挂牌→作业→摘牌→送电的次序记录，点检与停送电仅持证电工可操作。
        </p>
      </div>
      <div class="page-actions">
        <label class="account-picker">
          <span>当前账号</span>
          <select :value="accountKey" @change="switchAccount">
            <option v-for="item in accountPresets" :key="item.key" :value="item.key">
              {{ item.label }}
            </option>
          </select>
        </label>
        <button class="btn primary" type="button" :disabled="readonly" @click="openBackfill">
          补录配电箱
        </button>
      </div>
    </header>

    <p v-if="readonly" class="readonly-banner">{{ readonlyReason }}</p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">配电箱台账</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in boxColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>停送电阶段</th>
          <th>点检 / 整改</th>
          <th>停送电登记（下一步：按次序）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in boxes" :key="String(row.id)">
          <td v-for="column in boxColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.status === '待点检'" class="due-tag">点检周期已到</span>
          </td>
          <td>{{ row['停送电阶段'] ?? '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" :disabled="readonly" @click="openInspect(row)">
              登记点检
            </button>
            <button
              v-if="row.status === '待整改'"
              class="link"
              type="button"
              :disabled="readonly"
              @click="closeBox(row)"
            >
              整改闭环
            </button>
          </td>
          <td class="row-actions">
            <button
              v-for="step in powerSteps"
              :key="step"
              class="link"
              :class="{ 'next-step': nextStep(String(row['配电箱编号'])) === step }"
              type="button"
              :disabled="readonly"
              :title="`登记${step}`"
              @click="submitPowerOp(row, step)"
            >
              {{ step }}
            </button>
          </td>
        </tr>
        <tr v-if="!boxes.length">
          <td :colspan="boxColumns.length + 4" class="empty-state">暂无配电箱，可先补录</td>
        </tr>
      </tbody>
    </table>

    <form v-if="inspectTarget" class="panel" @submit.prevent="submitInspection">
      <h3 class="section-title">登记点检：{{ inspectTarget }}</h3>
      <div class="panel-row">
        <label class="filter-item">
          <span>点检日期</span>
          <input v-model="inspectForm.date" type="date" required />
        </label>
        <label class="filter-item">
          <span>漏电保护试验</span>
          <select v-model="inspectForm.result">
            <option value="通过">通过</option>
            <option value="不通过">不通过</option>
          </select>
        </label>
        <label v-if="inspectForm.result === '不通过'" class="filter-item">
          <span>未通过项（必填，说明哪一项没过）</span>
          <select v-model="inspectForm.failedItem" required>
            <option value="" disabled>请选择未通过项</option>
            <option v-for="item in leakageFailItems" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>备注</span>
          <input v-model="inspectForm.note" placeholder="选填" />
        </label>
        <button class="btn primary" type="submit">提交点检</button>
        <button class="btn ghost" type="button" @click="inspectTarget = ''">取消</button>
      </div>
    </form>

    <form v-if="backfillOpen" class="panel" @submit.prevent="submitBackfill">
      <h3 class="section-title">存量配电箱补录（按安装位置照旧登记）</h3>
      <div class="panel-row">
        <label class="filter-item">
          <span>配电箱编号</span>
          <input v-model="backfillForm.boxNo" required />
        </label>
        <label class="filter-item">
          <span>安装位置</span>
          <input v-model="backfillForm.location" placeholder="如：洞内左线K0+520" required />
        </label>
        <label class="filter-item">
          <span>责任班组</span>
          <select v-model="backfillForm.crew">
            <option v-for="crew in crewOptions" :key="crew" :value="crew">{{ crew }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>点检周期（天）</span>
          <input v-model.number="backfillForm.cycleDays" type="number" min="1" required />
        </label>
        <label class="filter-item">
          <span>漏电保护台账</span>
          <select v-model="backfillForm.hasLeakageLedger">
            <option :value="true">齐全</option>
            <option :value="false">缺失（记待补录，限期补做试验）</option>
          </select>
        </label>
        <button class="btn primary" type="submit">提交补录</button>
        <button class="btn ghost" type="button" @click="backfillOpen = false">取消</button>
      </div>
    </form>

    <h3 class="section-title">点检记录（电工台账）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in inspectColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in inspections" :key="String(row.id)">
          <td v-for="column in inspectColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!inspections.length">
          <td :colspan="inspectColumns.length" class="empty-state">暂无点检记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">班组共享视图（只读 · 与电工台账同源，不另存一份）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in inspectColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sharedInspections" :key="String(row.id)">
          <td v-for="column in inspectColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!sharedInspections.length">
          <td :colspan="inspectColumns.length" class="empty-state">暂无共享点检记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">停送电记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in opsColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in powerOps" :key="String(row.id)">
          <td v-for="column in opsColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!powerOps.length">
          <td :colspan="opsColumns.length" class="empty-state">暂无停送电记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">隐患项清单（送电前确认同录于此，与安全巡检台账同源）</h3>
    <p class="section-note">
      未整改配电箱：{{ unrectified }} 台 · 该清单与安全巡检台账读的是同一份数据，两处不会是两个数。
    </p>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in hazardColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in hazards" :key="String(row.id)">
          <td v-for="column in hazardColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!hazards.length">
          <td :colspan="hazardColumns.length" class="empty-state">暂无隐患项</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ boxes.length }} 台配电箱 · {{ inspections.length }} 条点检记录</span>
      <span v-if="notice.text" :class="notice.ok ? 'ok-text' : 'error-text'">{{ notice.text }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  backfillBox,
  closeRectification,
  listBoxes,
  listHazards,
  listInspections,
  listPowerOps,
  nextPowerStep,
  powerStats,
  registerInspection,
  registerPowerOp,
  sharedInspectionView,
  unrectifiedBoxCount,
} from '@/api/power-service'
import type { Account, PowerStep } from '@/data/power-types'
import { LEAKAGE_FAIL_ITEMS, PLATFORM_UNIT, POWER_STEPS } from '@/data/power-types'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const accountPresets: { key: string; label: string; account: Account }[] = [
  {
    key: 'zhangqi',
    label: '张启 · 持证电工（掘进一班）',
    account: { name: '张启', role: 'electrician', crew: '掘进一班', unit: PLATFORM_UNIT, certified: true },
  },
  {
    key: 'lishou',
    label: '李守 · 持证电工（机电班）',
    account: { name: '李守', role: 'electrician', crew: '机电班', unit: PLATFORM_UNIT, certified: true },
  },
  {
    key: 'wangban',
    label: '王班长 · 班组账号（掘进一班，只读）',
    account: { name: '王班长', role: 'crew', crew: '掘进一班', unit: PLATFORM_UNIT, certified: false },
  },
  {
    key: 'guest',
    label: '外协观察员 · 外单位账号（只读）',
    account: { name: '外协观察员', role: 'external', crew: '—', unit: '外协单位', certified: false },
  },
]

const accountKey = ref('zhangqi')
const readonly = computed(
  () =>
    session.account.role !== 'electrician' ||
    !session.account.certified ||
    session.account.unit !== PLATFORM_UNIT,
)
const readonlyReason = computed(() =>
  session.account.role === 'crew'
    ? '班组账号：台账看得到、改不动，点检与停送电须由持证电工操作。'
    : '外单位账号：一概不能改动，以下操作入口已停用。',
)

function switchAccount(event: Event) {
  const key = (event.target as HTMLSelectElement).value
  const preset = accountPresets.find((item) => item.key === key)
  if (!preset) {
    return
  }
  accountKey.value = key
  session.setAccount({ ...preset.account })
  inspectTarget.value = ''
  backfillOpen.value = false
  notice.value = { ok: true, text: `已切换为 ${preset.label}` }
}

const boxColumns = ['配电箱编号', '安装位置', '责任班组', '点检周期天', '最近点检日期', '下次点检日期', '漏电保护试验', '未通过项']
const inspectColumns = ['配电箱编号', '点检日期', '点检人', '漏电保护试验', '未通过项', '备注', '登记时间']
const opsColumns = ['配电箱编号', '步骤', '轮次', '操作人', '班组', '操作时间']
const hazardColumns = ['隐患编号', '配电箱编号', '隐患类型', '隐患描述', '提出人', '提出时间', '整改期限', '隐患状态', '闭环人', '闭环时间']
const powerSteps = POWER_STEPS
const leakageFailItems = LEAKAGE_FAIL_ITEMS
const crewOptions = ['掘进一班', '掘进二班', '机电班']

const boxes = ref<EntryRow[]>([])
const inspections = ref<EntryRow[]>([])
const sharedInspections = ref<ReadonlyArray<Readonly<EntryRow>>>([])
const powerOps = ref<EntryRow[]>([])
const hazards = ref<EntryRow[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const unrectified = ref(0)
const notice = ref<{ ok: boolean; text: string }>({ ok: true, text: '' })

const inspectTarget = ref('')
const inspectForm = ref({ date: '', result: '通过' as '通过' | '不通过', failedItem: '', note: '' })
const backfillOpen = ref(false)
const backfillForm = ref({ boxNo: '', location: '', crew: '掘进一班', cycleDays: 30, hasLeakageLedger: true })

function todayStr(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function nextStep(boxNo: string): PowerStep {
  return nextPowerStep(boxNo)
}

function openInspect(row: EntryRow) {
  inspectTarget.value = String(row['配电箱编号'])
  inspectForm.value = { date: todayStr(), result: '通过', failedItem: '', note: '' }
  backfillOpen.value = false
}

function openBackfill() {
  const maxId = boxes.value.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  backfillForm.value = {
    boxNo: `PD-${String(maxId + 1).padStart(4, '0')}`,
    location: '',
    crew: session.account.role === 'electrician' ? session.account.crew : '掘进一班',
    cycleDays: 30,
    hasLeakageLedger: true,
  }
  backfillOpen.value = true
  inspectTarget.value = ''
}

function show(result: { ok: boolean; message: string }) {
  notice.value = { ok: result.ok, text: result.message }
  reload()
}

function submitInspection() {
  show(
    registerInspection(session.account, {
      boxNo: inspectTarget.value,
      date: inspectForm.value.date,
      result: inspectForm.value.result,
      failedItem: inspectForm.value.failedItem,
      note: inspectForm.value.note,
    }),
  )
  inspectTarget.value = ''
}

function closeBox(row: EntryRow) {
  show(closeRectification(session.account, String(row['配电箱编号'])))
}

function submitPowerOp(row: EntryRow, step: PowerStep) {
  show(registerPowerOp(session.account, String(row['配电箱编号']), step))
}

function submitBackfill() {
  show(backfillBox(session.account, { ...backfillForm.value }))
  backfillOpen.value = false
}

function reload() {
  boxes.value = listBoxes()
  inspections.value = listInspections()
  sharedInspections.value = sharedInspectionView()
  powerOps.value = listPowerOps()
  hazards.value = listHazards()
  stats.value = powerStats()
  unrectified.value = unrectifiedBoxCount()
}

onMounted(reload)
</script>
