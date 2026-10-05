import { listRows, saveRows, transact } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type { ActionResult } from '@/data/types'
import type { Account, BackfillInput, InspectionInput, PowerStep } from '@/data/power-types'
import { PLATFORM_UNIT, POWER_STEPS } from '@/data/power-types'

// 洞内临时用电的四个数据域：配电箱台账、点检记录、停送电记录、隐患项清单。
// 隐患项清单全平台只有这一份，安全巡检台账读到的也是它，两侧不另存副本。
const BOX_KEY = 'power'
const INSPECT_KEY = 'power-inspect'
const OPS_KEY = 'power-ops'
const HAZARD_KEY = 'power-hazard'

/** 隐患项提出后要求闭环的天数。 */
const RECTIFY_DAYS = 7

function todayStr(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function nowStr(): string {
  const now = new Date()
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${todayStr()} ${hour}:${minute}`
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${month}-${day}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function deny(message: string): ActionResult {
  return { ok: false, message }
}

// —— 权限：越权改动整条拦下，不进任何写库流程 ——

function requireElectrician(account: Account): ActionResult | null {
  if (account.role === 'external' || account.unit !== PLATFORM_UNIT) {
    return deny('跨单位的账号一概不能改动，本次操作已整条拦下')
  }
  if (account.role === 'crew') {
    return deny('班组账号只能查看台账、不能改动，本次操作已整条拦下')
  }
  if (account.role !== 'electrician' || !account.certified) {
    return deny('点检与停送电只能由持证电工操作，本次操作已整条拦下')
  }
  return null
}

// —— 查询 ——

/** 点检周期到了就在台账上标出来：下次点检日期已到、状态还正常的箱，载入时标成「待点检」。 */
function refreshDueMarks(): EntryRow[] {
  const rows = listRows(BOX_KEY)
  const today = todayStr()
  let changed = false
  const next = rows.map((row) => {
    const dueDate = String(row['下次点检日期'] ?? '')
    if (row.status === '正常' && dueDate !== '' && dueDate !== '—' && dueDate <= today) {
      changed = true
      return { ...row, status: '待点检', pending: true }
    }
    return row
  })
  if (changed) {
    saveRows(BOX_KEY, next)
    return next
  }
  return rows
}

export function listBoxes(): EntryRow[] {
  return refreshDueMarks()
}

export function listInspections(): EntryRow[] {
  return listRows(INSPECT_KEY)
}

export function listPowerOps(): EntryRow[] {
  return listRows(OPS_KEY)
}

export function listHazards(): EntryRow[] {
  return listRows(HAZARD_KEY)
}

/**
 * 未整改配电箱数：全平台只从隐患项清单这一处算。
 * 临时用电台账与安全巡检台账读到的必须是同一个数，靠的就是同源。
 */
export function unrectifiedBoxCount(): number {
  const open = listRows(HAZARD_KEY).filter((row) => row['隐患状态'] === '待整改')
  return new Set(open.map((row) => String(row['配电箱编号']))).size
}

/** 共享给班组的点检记录：与电工台账同源，只读视图，不另存一份。 */
export function sharedInspectionView(): ReadonlyArray<Readonly<EntryRow>> {
  return Object.freeze(listRows(INSPECT_KEY).map((row) => Object.freeze({ ...row })))
}

/** 共享出去的隐患项清单（安全巡检台账用的就是这份），同样只读、同源。 */
export function sharedHazardView(): ReadonlyArray<Readonly<EntryRow>> {
  return Object.freeze(listRows(HAZARD_KEY).map((row) => Object.freeze({ ...row })))
}

export function powerStats(): { label: string; value: number }[] {
  const boxes = listBoxes()
  const flowing = boxes.filter((row) =>
    ['已停电', '已挂牌', '作业中', '已摘牌'].includes(String(row['停送电阶段'])),
  ).length
  return [
    { label: '配电箱总数', value: boxes.length },
    { label: '到期待点检', value: boxes.filter((row) => row.status === '待点检').length },
    { label: '未整改配电箱', value: unrectifiedBoxCount() },
    { label: '停送电流程中', value: flowing },
  ]
}

// —— 隐患项：只在事务里调用 ——

function appendHazard(input: {
  boxNo: string
  type: string
  desc: string
  operator: string
  deadline: string
  closed: boolean
}): void {
  const hazards = listRows(HAZARD_KEY)
  const id = nextId(hazards)
  const row: EntryRow = {
    id,
    status: input.closed ? '已确认' : '待整改',
    pending: !input.closed,
    abnormal: !input.closed,
    隐患编号: `HZ-${String(id).padStart(4, '0')}`,
    配电箱编号: input.boxNo,
    隐患类型: input.type,
    隐患描述: input.desc,
    提出人: input.operator,
    提出时间: todayStr(),
    整改期限: input.deadline,
    隐患状态: input.closed ? '已确认' : '待整改',
    闭环人: input.closed ? input.operator : '—',
    闭环时间: input.closed ? todayStr() : '—',
  }
  saveRows(HAZARD_KEY, [...hazards, row])
}

function openHazardsOf(boxNo: string): EntryRow[] {
  return listRows(HAZARD_KEY).filter(
    (row) => row['配电箱编号'] === boxNo && row['隐患状态'] === '待整改',
  )
}

// —— 点检登记 ——

export function registerInspection(account: Account, input: InspectionInput): ActionResult {
  const denied = requireElectrician(account)
  if (denied) {
    return denied
  }
  if (input.result === '不通过' && input.failedItem.trim() === '') {
    return deny('漏电保护试验不通过必须说明是哪一项没过')
  }
  const box = listRows(BOX_KEY).find((row) => row['配电箱编号'] === input.boxNo)
  if (!box) {
    return deny(`没有找到配电箱 ${input.boxNo}`)
  }
  // 重复登记只留最早那条：同箱同日已有点检记录，后来的一律不收。
  const duplicated = listRows(INSPECT_KEY).find(
    (row) => row['配电箱编号'] === input.boxNo && row['点检日期'] === input.date,
  )
  if (duplicated) {
    return deny(`${input.boxNo} 在 ${input.date} 已有点检记录（第 ${duplicated.id} 条），重复登记只留最早那条`)
  }
  try {
    return transact([BOX_KEY, INSPECT_KEY, HAZARD_KEY], () => {
      const failed = input.result === '不通过'
      const failedItem = failed ? input.failedItem.trim() : '—'
      const inspections = listRows(INSPECT_KEY)
      saveRows(INSPECT_KEY, [
        ...inspections,
        {
          id: nextId(inspections),
          status: failed ? '待整改' : '已点检',
          pending: failed,
          abnormal: failed,
          配电箱编号: input.boxNo,
          点检日期: input.date,
          点检人: account.name,
          漏电保护试验: input.result,
          未通过项: failedItem,
          备注: input.note.trim() || '—',
          登记时间: nowStr(),
        },
      ])
      // 台账同步：试验不通过直接进待整改；通过但还有未闭环隐患的，保持待整改直到闭环。
      const cycleDays = Number(box['点检周期天']) || 30
      const stillOpen = openHazardsOf(input.boxNo).length > 0
      const nextStatus = failed || stillOpen ? '待整改' : '正常'
      saveRows(
        BOX_KEY,
        listRows(BOX_KEY).map((row) =>
          row['配电箱编号'] === input.boxNo
            ? {
                ...row,
                status: nextStatus,
                pending: nextStatus !== '正常',
                abnormal: failed || (stillOpen && nextStatus !== '正常'),
                最近点检日期: input.date,
                下次点检日期: addDays(input.date, cycleDays),
                漏电保护试验: input.result,
                未通过项: failedItem,
                点检人: account.name,
              }
            : row,
        ),
      )
      if (failed) {
        appendHazard({
          boxNo: input.boxNo,
          type: '漏电保护试验不通过',
          desc: `漏电保护试验不通过：${failedItem}`,
          operator: account.name,
          deadline: addDays(input.date, RECTIFY_DAYS),
          closed: false,
        })
        return { ok: true, message: `已登记点检，漏电保护试验不通过（${failedItem}），${input.boxNo} 已进入待整改` }
      }
      if (stillOpen) {
        return { ok: true, message: `已登记点检且试验通过；${input.boxNo} 仍有未闭环隐患项，需整改闭环后转正常` }
      }
      return { ok: true, message: `已登记点检，${input.boxNo} 漏电保护试验通过` }
    })
  } catch {
    return deny('落库失败，本次点检登记已整体回滚')
  }
}

// —— 整改闭环 ——

export function closeRectification(account: Account, boxNo: string): ActionResult {
  const denied = requireElectrician(account)
  if (denied) {
    return denied
  }
  const box = listRows(BOX_KEY).find((row) => row['配电箱编号'] === boxNo)
  if (!box) {
    return deny(`没有找到配电箱 ${boxNo}`)
  }
  const open = openHazardsOf(boxNo)
  if (open.length === 0) {
    return deny(`${boxNo} 没有待整改的隐患项`)
  }
  // 特殊情形裁决：闭环前必须补做一次漏电保护试验且通过，防止只点按钮不验设备。
  if (String(box['漏电保护试验']) !== '通过') {
    return deny(`${boxNo} 最近一次漏电保护试验未通过，请先登记一次通过的点检再闭环`)
  }
  try {
    return transact([BOX_KEY, HAZARD_KEY], () => {
      saveRows(
        HAZARD_KEY,
        listRows(HAZARD_KEY).map((row) =>
          row['配电箱编号'] === boxNo && row['隐患状态'] === '待整改'
            ? { ...row, status: '已闭环', pending: false, abnormal: false, 隐患状态: '已闭环', 闭环人: account.name, 闭环时间: todayStr() }
            : row,
        ),
      )
      saveRows(
        BOX_KEY,
        listRows(BOX_KEY).map((row) =>
          row['配电箱编号'] === boxNo
            ? { ...row, status: '正常', pending: false, abnormal: false }
            : row,
        ),
      )
      return { ok: true, message: `${boxNo} 的 ${open.length} 条隐患项已闭环，台账转正常` }
    })
  } catch {
    return deny('落库失败，本次整改闭环已整体回滚')
  }
}

// —— 停送电：停电→挂牌→作业→摘牌→送电 ——

function nextStepOf(lastStep: string | null): PowerStep {
  if (lastStep === null || lastStep === '送电') {
    return '停电'
  }
  const index = POWER_STEPS.indexOf(lastStep as PowerStep)
  return POWER_STEPS[index + 1]
}

/** 给页面提示用：这台箱当前轮次下一步该登记哪一步。 */
export function nextPowerStep(boxNo: string): PowerStep {
  const ops = listRows(OPS_KEY).filter((row) => row['配电箱编号'] === boxNo)
  if (ops.length === 0) {
    return '停电'
  }
  const cycle = Math.max(...ops.map((row) => Number(row['轮次']) || 1))
  const cycleOps = ops.filter((row) => Number(row['轮次']) === cycle)
  const last = cycleOps[cycleOps.length - 1]
  return nextStepOf(last ? String(last['步骤']) : null)
}

export function registerPowerOp(account: Account, boxNo: string, step: PowerStep): ActionResult {
  const denied = requireElectrician(account)
  if (denied) {
    return denied
  }
  const box = listRows(BOX_KEY).find((row) => row['配电箱编号'] === boxNo)
  if (!box) {
    return deny(`没有找到配电箱 ${boxNo}`)
  }
  // 跨班组的停送电登记一律拦下。
  if (String(box['责任班组']) !== account.crew) {
    return deny(`${boxNo} 的责任班组是${String(box['责任班组'])}，跨班组的停送电登记一律拦下`)
  }
  const ops = listRows(OPS_KEY).filter((row) => row['配电箱编号'] === boxNo)
  const cycle = ops.length === 0 ? 1 : Math.max(...ops.map((row) => Number(row['轮次']) || 1))
  const cycleOps = ops.filter((row) => Number(row['轮次']) === cycle)
  const last = cycleOps[cycleOps.length - 1]
  const lastStep = last ? String(last['步骤']) : null
  const cycleClosed = lastStep === '送电'
  const effectiveCycle = cycleClosed ? cycle + 1 : cycle
  const effectiveLast = cycleClosed ? null : lastStep

  // 同一台配电箱重复提交同一步，只生效最早那次。
  if (effectiveLast !== null && step === effectiveLast) {
    return { ok: true, message: `${boxNo} 已登记过「${step}」，重复提交只生效最早那条，本次不再落库` }
  }
  const expected = nextStepOf(effectiveLast)
  if (step !== expected) {
    if (step === '送电' && !cycleOps.some((row) => row['步骤'] === '挂牌')) {
      return deny(`${boxNo} 没挂牌就送电，记录已挡回`)
    }
    return deny(`停送电须按停电→挂牌→作业→摘牌→送电的次序登记，${boxNo} 当前应登记「${expected}」`)
  }
  // 特殊情形裁决：送电前确认不通过（还有未闭环隐患项）的，一律挡回。
  if (step === '送电') {
    const open = openHazardsOf(boxNo).length
    if (open > 0) {
      return deny(`${boxNo} 还有 ${open} 条未闭环隐患项，送电前确认不通过，记录已挡回`)
    }
  }
  try {
    return transact([BOX_KEY, OPS_KEY, HAZARD_KEY], () => {
      const all = listRows(OPS_KEY)
      saveRows(OPS_KEY, [
        ...all,
        {
          id: nextId(all),
          status: '已登记',
          pending: step !== '送电',
          abnormal: false,
          配电箱编号: boxNo,
          步骤: step,
          轮次: effectiveCycle,
          操作人: account.name,
          班组: account.crew,
          操作时间: nowStr(),
        },
      ])
      saveRows(
        BOX_KEY,
        listRows(BOX_KEY).map((row) =>
          row['配电箱编号'] === boxNo ? { ...row, 停送电阶段: `已${step}` } : row,
        ),
      )
      if (step === '送电') {
        // 送电前的确认写进隐患项清单，安全巡检台账同源可读。
        appendHazard({
          boxNo,
          type: '送电前确认',
          desc: `送电前确认：${boxNo} 无未闭环隐患项，漏电保护试验通过，准予送电`,
          operator: account.name,
          deadline: '—',
          closed: true,
        })
      }
      return { ok: true, message: `${boxNo} 已登记「${step}」（第 ${effectiveCycle} 轮）` }
    })
  } catch {
    return deny('落库失败，本次停送电登记已整体回滚')
  }
}

// —— 存量配电箱补录 ——

export function backfillBox(account: Account, input: BackfillInput): ActionResult {
  const denied = requireElectrician(account)
  if (denied) {
    return denied
  }
  if (input.boxNo.trim() === '') {
    return deny('配电箱编号不能为空')
  }
  if (input.location.trim() === '') {
    return deny('存量配电箱按安装位置照旧补录，安装位置不能为空')
  }
  // 重复登记只留最早那条。
  if (listRows(BOX_KEY).some((row) => row['配电箱编号'] === input.boxNo.trim())) {
    return deny(`配电箱 ${input.boxNo} 已登记过，重复登记只留最早那条`)
  }
  try {
    return transact([BOX_KEY, HAZARD_KEY], () => {
      const today = todayStr()
      const boxes = listRows(BOX_KEY)
      saveRows(BOX_KEY, [
        ...boxes,
        {
          id: nextId(boxes),
          status: input.hasLeakageLedger ? '正常' : '待整改',
          pending: !input.hasLeakageLedger,
          abnormal: !input.hasLeakageLedger,
          配电箱编号: input.boxNo.trim(),
          安装位置: input.location.trim(),
          责任班组: input.crew,
          点检周期天: input.cycleDays,
          最近点检日期: input.hasLeakageLedger ? today : '—',
          下次点检日期: input.hasLeakageLedger ? addDays(today, input.cycleDays) : '—',
          漏电保护试验: input.hasLeakageLedger ? '通过' : '待补录',
          未通过项: '—',
          点检人: input.hasLeakageLedger ? account.name : '—',
          停送电阶段: '—',
        },
      ])
      if (!input.hasLeakageLedger) {
        // 裁决：缺漏电保护台账的一律记「待补录」，自动生成隐患项限期补做试验，补齐前送电会被挡回。
        appendHazard({
          boxNo: input.boxNo.trim(),
          type: '漏电保护台账缺失',
          desc: `存量补录时缺漏电保护台账，限 ${RECTIFY_DAYS} 日内补做漏电保护试验`,
          operator: account.name,
          deadline: addDays(today, RECTIFY_DAYS),
          closed: false,
        })
        return { ok: true, message: `${input.boxNo} 已按安装位置补录；缺漏电保护台账，已进待整改并限期补做试验` }
      }
      return { ok: true, message: `${input.boxNo} 已按安装位置补录，漏电保护台账齐全` }
    })
  } catch {
    return deny('落库失败，本次补录已整体回滚')
  }
}
