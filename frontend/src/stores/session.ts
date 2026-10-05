import { defineStore } from 'pinia'

// 角色：admin 项目部管理员；electrician 持证电工（点检、停送电只能他们操作）；
// crew 班组账号（台账只读）；external 外单位账号（一概不能改动）。
export type RoleKey = 'admin' | 'electrician' | 'crew' | 'external'

export type IdentityPreset = {
  key: string
  label: string
  operator: string
  role: RoleKey
  crewName: string
  certNo: string
}

export const IDENTITY_PRESETS: IdentityPreset[] = [
  { key: 'admin', label: '值班管理员（项目部）', operator: '值班管理员', role: 'admin', crewName: '项目部', certNo: '' },
  { key: 'electrician-1', label: '张有电 · 持证电工（电工一班）', operator: '张有电', role: 'electrician', crewName: '电工一班', certNo: 'DG-2026-001' },
  { key: 'electrician-2', label: '李合闸 · 持证电工（电工二班）', operator: '李合闸', role: 'electrician', crewName: '电工二班', certNo: 'DG-2026-002' },
  { key: 'crew', label: '掘进一班 · 班组账号', operator: '掘进一班班组账号', role: 'crew', crewName: '掘进一班', certNo: '' },
  { key: 'external', label: '外协单位 · 观摩账号', operator: '外协单位观摩账号', role: 'external', crewName: '外协单位', certNo: '' },
]

const ROLE_LABELS: Record<RoleKey, string> = {
  admin: '项目部管理员',
  electrician: '持证电工',
  crew: '班组账号',
  external: '外单位账号',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    role: 'admin' as RoleKey,
    crewName: '项目部',
    certNo: '',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isElectrician: (state) => state.role === 'electrician' && state.certNo.length > 0,
    canWriteLedger: (state) => state.role === 'admin' || state.role === 'electrician',
    roleLabel: (state) => ROLE_LABELS[state.role],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(key: string) {
      const preset = IDENTITY_PRESETS.find((item) => item.key === key) ?? IDENTITY_PRESETS[0]
      this.operator = preset.operator
      this.role = preset.role
      this.crewName = preset.crewName
      this.certNo = preset.certNo
    },
  },
})
