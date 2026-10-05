import { defineStore } from 'pinia'

import type { Account } from '@/data/power-types'
import { PLATFORM_UNIT } from '@/data/power-types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    // 当前登录账号：临时用电的点检与停送电权限都按它判定，默认持证电工。
    account: {
      name: '张启',
      role: 'electrician',
      crew: '掘进一班',
      unit: PLATFORM_UNIT,
      certified: true,
    } as Account,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setAccount(account: Account) {
      this.account = account
      this.operator = account.name
    },
  },
})
