import { POWER_MODULE_KEY } from '@/data/modules'
import { listRows, saveMany } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow } from '@/data/types'

// 洞内临时用电专用流转。约定与 local-service 一致：页面只渲染，业务判断全部在这里。
// 三份数据都落在同一份 localStorage 台账里：
//   power              配电箱台账（模块实体）
//   power-inspections  点检记录，按配电箱登记
//   power-switching    停送电记录，按 停电→挂牌→作业→摘牌→送电 次序登记
const INSPECTION_KEY = 'power-inspections'
const SWITCHING_KEY = 'power-switching'
const SAFETY_KEY = 'safety'

export const SWITCH_STEPS = ['停电', '挂牌', '作业', '摘牌', '送电'] as const
export type SwitchStep = (typeof SWITCH_STEPS)[number]

// 漏电保护试验不通过时必须点明是哪一项没过。
export const LEAK_TEST_ITEMS = ['漏电保护器动作试验', '绝缘电阻测试', '接地电阻测试'] as const

// 送电前确认写进巡检台账时用的巡检项目名，安全巡检页按它筛出隐患项清单。
export const POWER_CONFIRM_ITEM = '临时用电送电前确认'

function todayStr(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function nowStr(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${todayStr()} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(prefix: string, rows: EntryRow[], field: string): string {
  const max = rows.reduce((acc, row) => {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// 越权拦截：整条拦下，什么都不写。班组只读，外单位一概不能改。
function writeGuard(): ActionResult | null {
  const session = useSessionStore()
  if (session.role === 'external') {
    return { ok: false, message: '跨单位账号一概不能改动洞内临时用电台账' }
  }
  if (session.role === 'crew') {
    return { ok: false, message: '班组账号只看得到台账，改不动' }
  }
  return null
}

function electricianGuard(): ActionResult | null {
  const denied = writeGuard()
  if (denied) {
    return denied
  }
  const session = useSessionStore()
  if (!session.isElectrician) {
    return { ok: false, message: '点检与停送电只能由持证电工操作' }
  }
  return null
}

// 落库：写不进去就整体回滚（saveMany 先写存储后换缓存，抛错时缓存没动）。
function commit(updates: Record<string, EntryRow[]>): ActionResult | null {
  try {
    saveMany(updates)
    return null
  } catch {
    return { ok: false, message: '落库不成功，本次登记已一并回滚' }
  }
}

export function listBoxes(): EntryRow[] {
  return listRows(POWER_MODULE_KEY)
}

export function listInspections(): EntryRow[] {
  return listRows(INSPECTION_KEY)
}

export function listSwitching(): EntryRow[] {
  return listRows(SWITCHING_KEY)
}

// 未整改配电箱数唯一的取数口：台账里状态为「待整改」的配电箱。
// 临时用电页和安全巡检页都从这里读，两处不会出现两个数。
export function unrectifiedBoxes(): EntryRow[] {
  return listBoxes().filter((row) => row.status === '待整改')
}

export function countUnrectifiedBoxes(): number {
  return unrectifiedBoxes().length
}

// 巡检台账里的送电前确认记录，与点检台账同源，不另存一份。
export function powerConfirmations(): EntryRow[] {
  return listRows(SAFETY_KEY).filter((row) => row['巡检项目'] === POWER_CONFIRM_ITEM)
}

// 点检周期到了就在台账上标出来：正常 → 到期待点检。打开页面时刷一遍。
export function refreshDueBoxes(): EntryRow[] {
  const today = todayStr()
  const boxes = listBoxes()
  let changed = false
  const next = boxes.map((row) => {
    const due = String(row['下次点检日期'] ?? '')
    if (row.status === '正常' && due !== '' && due <= today) {
      changed = true
      return { ...row, status: '到期待点检', pending: true }
    }
    return row
  })
  if (changed) {
    try {
      saveMany({ [POWER_MODULE_KEY]: next })
    } catch {
      return boxes
    }
    return next
  }
  return boxes
}

export function suggestBoxCode(): string {
  return nextCode('PDX', listBoxes(), '配电箱编号')
}

export type BoxInput = {
  配电箱编号: string
  安装位置: string
  所属班组: string
  责任单位: string
  点检周期: number
  漏电保护台账已建: boolean
}

// 登记/补录配电箱。存量补录缺漏电保护台账的：台账上标「待补测」并进点检计划，
// 同时补一条补录点检记录说明缺口，等持证电工实测后按正常点检覆盖。
export function registerBox(input: BoxInput): ActionResult {
  const denied = writeGuard()
  if (denied) {
    return denied
  }
  const code = input.配电箱编号.trim()
  if (!code || !input.安装位置.trim() || !input.所属班组.trim()) {
    return { ok: false, message: '配电箱编号、安装位置、所属班组都要填' }
  }
  if (!(input.点检周期 > 0)) {
    return { ok: false, message: '点检周期要是大于 0 的天数' }
  }
  const boxes = listBoxes()
  if (boxes.some((row) => row['配电箱编号'] === code)) {
    return { ok: false, message: `配电箱 ${code} 已登记，重复登记只留最早那条` }
  }
  const today = todayStr()
  const tested = input.漏电保护台账已建
  const box: EntryRow = {
    id: nextId(boxes),
    status: tested ? '正常' : '到期待点检',
    pending: !tested,
    abnormal: false,
    配电箱编号: code,
    安装位置: input.安装位置.trim(),
    所属班组: input.所属班组.trim(),
    责任单位: input.责任单位.trim() || '机电部',
    点检周期: input.点检周期,
    最近点检日期: tested ? today : '',
    下次点检日期: tested ? addDays(today, input.点检周期) : today,
    漏电保护试验: tested ? '通过' : '待补测',
    未通过项: '',
  }
  const updates: Record<string, EntryRow[]> = { [POWER_MODULE_KEY]: [...boxes, box] }
  if (!tested) {
    const inspections = listInspections()
    const note: EntryRow = {
      id: nextId(inspections),
      status: '补录',
      pending: true,
      abnormal: false,
      点检编号: nextCode('DJ', inspections, '点检编号'),
      配电箱编号: code,
      点检日期: today,
      点检人: useSessionStore().operator,
      电工证号: '—',
      漏电保护试验: '待补测',
      未通过项: '',
      点检结论: '存量补录，缺漏电保护台账，待实测补齐',
    }
    updates[INSPECTION_KEY] = [...inspections, note]
  }
  const failed = commit(updates)
  if (failed) {
    return failed
  }
  return {
    ok: true,
    message: tested
      ? `配电箱 ${code} 已登记`
      : `配电箱 ${code} 已补录，缺漏电保护台账，已标「待补测」并排入点检计划`,
  }
}

export type InspectionInput = {
  boxId: number
  点检日期: string
  漏电保护试验: '通过' | '不通过'
  未通过项: string
}

// 按配电箱登记点检：只有持证电工能登；不通过的直接进待整改并写明哪项没过；
// 同一配电箱同一天同人重复登记只留最早那条。
export function registerInspection(input: InspectionInput): ActionResult {
  const denied = electricianGuard()
  if (denied) {
    return denied
  }
  const session = useSessionStore()
  const boxes = listBoxes()
  const box = boxes.find((row) => Number(row.id) === input.boxId)
  if (!box) {
    return { ok: false, message: '没有找到这台配电箱' }
  }
  if (box.status === '已停用') {
    return { ok: false, message: `配电箱 ${box['配电箱编号']} 已停用，不再安排点检` }
  }
  if (!input.点检日期) {
    return { ok: false, message: '点检日期要填' }
  }
  if (input.漏电保护试验 === '不通过' && !LEAK_TEST_ITEMS.includes(input.未通过项 as (typeof LEAK_TEST_ITEMS)[number])) {
    return { ok: false, message: '漏电保护试验不通过，必须说明是哪一项没过' }
  }
  const inspections = listInspections()
  const duplicated = inspections.some(
    (row) =>
      row['配电箱编号'] === box['配电箱编号'] &&
      row['点检日期'] === input.点检日期 &&
      row['点检人'] === session.operator,
  )
  if (duplicated) {
    return { ok: false, message: '该配电箱当日点检已登记，重复登记只留最早那条' }
  }
  const passed = input.漏电保护试验 === '通过'
  const record: EntryRow = {
    id: nextId(inspections),
    status: passed ? '合格' : '待整改',
    pending: !passed,
    abnormal: !passed,
    点检编号: nextCode('DJ', inspections, '点检编号'),
    配电箱编号: box['配电箱编号'],
    点检日期: input.点检日期,
    点检人: session.operator,
    电工证号: session.certNo,
    漏电保护试验: input.漏电保护试验,
    未通过项: passed ? '' : input.未通过项,
    点检结论: passed ? '合格' : `不合格，${input.未通过项}没过，转待整改`,
  }
  const cycle = Number(box['点检周期']) > 0 ? Number(box['点检周期']) : 30
  const updatedBox: EntryRow = {
    ...box,
    status: passed ? '正常' : '待整改',
    pending: !passed,
    abnormal: !passed,
    最近点检日期: input.点检日期,
    下次点检日期: addDays(input.点检日期, cycle),
    漏电保护试验: input.漏电保护试验,
    未通过项: passed ? '' : input.未通过项,
  }
  const failed = commit({
    [INSPECTION_KEY]: [...inspections, record],
    [POWER_MODULE_KEY]: boxes.map((row) => (Number(row.id) === input.boxId ? updatedBox : row)),
  })
  if (failed) {
    return failed
  }
  return {
    ok: true,
    message: passed
      ? `配电箱 ${box['配电箱编号']} 点检合格，下次点检 ${updatedBox['下次点检日期']}`
      : `配电箱 ${box['配电箱编号']} ${input.未通过项}没过，已进待整改`,
  }
}

function latestStep(boxCode: string): EntryRow | undefined {
  return listSwitching()
    .filter((row) => row['配电箱编号'] === boxCode)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .pop()
}

// 这台配电箱下一步该登记哪一步，页面照着显示。
export function nextSwitchStep(boxCode: string): SwitchStep {
  const latest = latestStep(boxCode)
  if (!latest) {
    return '停电'
  }
  const index = SWITCH_STEPS.indexOf(latest['操作步骤'] as SwitchStep)
  return index < 0 || index === SWITCH_STEPS.length - 1 ? '停电' : SWITCH_STEPS[index + 1]
}

export type SwitchInput = {
  boxId: number
  step: SwitchStep
  送电前确认: string
}

// 停送电登记：持证电工本班组才能登；严格按 停电→挂牌→作业→摘牌→送电 走，
// 没挂牌就送电直接挡回；同一步重复提交只生效第一次；送电前确认写进巡检台账隐患项清单。
export function registerSwitching(input: SwitchInput): ActionResult {
  const denied = electricianGuard()
  if (denied) {
    return denied
  }
  const session = useSessionStore()
  const box = listBoxes().find((row) => Number(row.id) === input.boxId)
  if (!box) {
    return { ok: false, message: '没有找到这台配电箱' }
  }
  if (box.status === '已停用') {
    return { ok: false, message: `配电箱 ${box['配电箱编号']} 已停用，不能登记停送电` }
  }
  if (box['所属班组'] !== session.crewName) {
    return { ok: false, message: `配电箱 ${box['配电箱编号']} 属${box['所属班组']}，跨班组的停送电登记一律拦下` }
  }
  const boxCode = String(box['配电箱编号'])
  const latest = latestStep(boxCode)
  if (latest && latest['操作步骤'] === input.step) {
    return { ok: true, message: `「${input.step}」已登记过，同一台配电箱重复提交只生效一次` }
  }
  const expected = nextSwitchStep(boxCode)
  if (input.step !== expected) {
    if (input.step === '送电') {
      return { ok: false, message: '没挂牌就送电，这条记录挡回' }
    }
    return { ok: false, message: `停送电要按停电→挂牌→作业→摘牌→送电的次序来，当前该登记「${expected}」` }
  }
  if (input.step === '送电') {
    if (box.status === '待整改') {
      return { ok: false, message: `配电箱 ${boxCode} 还有未整改项（${box['未通过项']}），不得送电` }
    }
    if (!input.送电前确认.trim()) {
      return { ok: false, message: '送电前确认要填，这条确认会写进巡检台账的隐患项清单' }
    }
  }
  const switching = listSwitching()
  const record: EntryRow = {
    id: nextId(switching),
    status: '已登记',
    pending: input.step !== '送电',
    abnormal: false,
    操作编号: nextCode('TD', switching, '操作编号'),
    配电箱编号: boxCode,
    操作步骤: input.step,
    操作人: session.operator,
    电工证号: session.certNo,
    所属班组: session.crewName,
    操作时间: nowStr(),
    送电前确认: input.step === '送电' ? input.送电前确认.trim() : '',
  }
  const updates: Record<string, EntryRow[]> = { [SWITCHING_KEY]: [...switching, record] }
  if (input.step === '送电') {
    const safety = listRows(SAFETY_KEY)
    const confirmation: EntryRow = {
      id: nextId(safety),
      status: '已巡检',
      pending: false,
      abnormal: false,
      巡检编号: nextCode('SAFE', safety, '巡检编号'),
      巡检区域: box['安装位置'],
      巡检项目: POWER_CONFIRM_ITEM,
      发现问题: `送电前确认：${input.送电前确认.trim()}`,
      隐患等级: '一般',
      整改期限: '',
      巡检人员: session.operator,
      巡检状态: '已巡检',
    }
    updates[SAFETY_KEY] = [...safety, confirmation]
  }
  const failed = commit(updates)
  if (failed) {
    return failed
  }
  return { ok: true, message: `配电箱 ${boxCode} 已登记「${input.step}」` }
}
