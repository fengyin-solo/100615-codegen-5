<template>
  <section class="page" data-module="safety">
    <header class="page-head">
      <div>
        <h2>安全巡检管理</h2>
        <p class="page-desc">维护巡检记录，围绕巡检编号、巡检区域、巡检项目、发现问题做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出安全巡检清单</button>
      </div>
    </header>

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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无安全巡检数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">临时用电隐患项清单</h3>
    <p class="section-desc">
      与洞内临时用电台账同源，只留一份；未整改配电箱数 <strong>{{ powerUnrectified.length }}</strong>。
    </p>
    <table class="data-table">
      <thead>
        <tr>
          <th>配电箱编号</th>
          <th>安装位置</th>
          <th>所属班组</th>
          <th>未通过项</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in powerUnrectified" :key="String(row.id)">
          <td>{{ row['配电箱编号'] }}</td>
          <td>{{ row['安装位置'] }}</td>
          <td>{{ row['所属班组'] }}</td>
          <td>{{ row['未通过项'] || '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!powerUnrectified.length">
          <td colspan="5" class="empty-state">当前没有未整改的配电箱</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">送电前确认记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>巡检编号</th>
          <th>巡检区域</th>
          <th>确认内容</th>
          <th>确认人</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in powerConfirms" :key="String(row.id)">
          <td>{{ row['巡检编号'] }}</td>
          <td>{{ row['巡检区域'] }}</td>
          <td>{{ row['发现问题'] }}</td>
          <td>{{ row['巡检人员'] }}</td>
        </tr>
        <tr v-if="!powerConfirms.length">
          <td colspan="4" class="empty-state">暂无送电前确认记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全巡检记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { powerConfirmations, unrectifiedBoxes } from '@/api/power-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('safety')
const columns = ["巡检编号", "巡检区域", "巡检项目", "发现问题", "隐患等级", "整改期限", "巡检人员", "巡检状态"]
const actions = ["提交巡检", "派发整改", "确认闭环"]
const statuses = ["待巡检", "已巡检", "待整改", "已闭环"]
const stats = [{"label": "待巡检区域", "value": 0}, {"label": "待整改隐患", "value": 0}, {"label": "已闭环隐患", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const powerUnrectified = ref<EntryRow[]>([])
const powerConfirms = ref<EntryRow[]>([])
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    powerUnrectified.value = unrectifiedBoxes()
    powerConfirms.value = powerConfirmations()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全巡检列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  font-size: 14px;
  margin: 16px 0 8px;
}
.section-desc {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
</style>
