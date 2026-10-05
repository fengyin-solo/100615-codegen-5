// 洞内临时用电的专用类型与常量：账号角色、停送电步骤、隐患类型集中在这里，服务层与页面共用。

export type AccountRole = 'electrician' | 'crew' | 'external'

/** 当前操作账号：点检与停送电的权限、跨班组拦截都按它判定。 */
export type Account = {
  name: string
  role: AccountRole // electrician=电工 crew=班组账号 external=外单位账号
  crew: string // 所属班组
  unit: string // 所属单位
  certified: boolean // 是否持证电工
}

/** 平台所属单位：单位对不上的账号一概不能改动。 */
export const PLATFORM_UNIT = '项目部'

/** 停送电固定次序：停电→挂牌→作业→摘牌→送电。 */
export const POWER_STEPS = ['停电', '挂牌', '作业', '摘牌', '送电'] as const
export type PowerStep = (typeof POWER_STEPS)[number]

export const BOX_STATUSES = ['正常', '待点检', '待整改'] as const

export const HAZARD_TYPES = ['漏电保护试验不通过', '漏电保护台账缺失', '送电前确认'] as const

/** 漏电保护试验不通过时必须指明是哪一项没过。 */
export const LEAKAGE_FAIL_ITEMS = ['漏电保护器拒动', '漏电保护器误动', '试验按钮失效', '动作电流超标'] as const

export type InspectionInput = {
  boxNo: string
  date: string
  result: '通过' | '不通过'
  failedItem: string
  note: string
}

export type BackfillInput = {
  boxNo: string
  location: string
  crew: string
  cycleDays: number
  hasLeakageLedger: boolean
}
