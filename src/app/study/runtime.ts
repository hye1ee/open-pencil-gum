import { readonly, shallowRef } from 'vue'

export const STUDY_CONDITIONS = ['userlens', 'ask-user', 'user-initiated', 'hands-off'] as const

export type StudyCondition = (typeof STUDY_CONDITIONS)[number]
export type StudyHost = 'lenchat' | 'lencanvas'
export type StudyFeedbackExecution = 'silent-retry' | 'tool-resume' | 'no-intervention'

export interface StudyRuntimeConfig {
  host: StudyHost
  condition: StudyCondition
  metaAgentEnabled: boolean
  askUserEnabled: boolean
  showRawReasoning: boolean
  allowFreeIntervention: boolean
  taskAgentUsesUserModel: boolean
  updateUserModel: boolean
  feedbackExecution: StudyFeedbackExecution
}

type ConditionConfig = Omit<StudyRuntimeConfig, 'host' | 'condition'>

const CONDITION_CONFIGS: Record<StudyCondition, ConditionConfig> = {
  userlens: {
    metaAgentEnabled: true,
    askUserEnabled: false,
    showRawReasoning: false,
    allowFreeIntervention: false,
    taskAgentUsesUserModel: true,
    updateUserModel: true,
    feedbackExecution: 'silent-retry'
  },
  'ask-user': {
    metaAgentEnabled: false,
    askUserEnabled: true,
    showRawReasoning: false,
    allowFreeIntervention: false,
    taskAgentUsesUserModel: false,
    updateUserModel: true,
    feedbackExecution: 'tool-resume'
  },
  'user-initiated': {
    metaAgentEnabled: false,
    askUserEnabled: false,
    showRawReasoning: false,
    allowFreeIntervention: true,
    taskAgentUsesUserModel: false,
    updateUserModel: true,
    feedbackExecution: 'silent-retry'
  },
  'hands-off': {
    metaAgentEnabled: false,
    askUserEnabled: false,
    showRawReasoning: false,
    allowFreeIntervention: false,
    taskAgentUsesUserModel: true,
    updateUserModel: false,
    feedbackExecution: 'no-intervention'
  }
}

export function isHandsOffDelegationCondition(condition: StudyCondition): boolean {
  return condition === 'hands-off'
}

export function isStudyCondition(value: unknown): value is StudyCondition {
  return typeof value === 'string' && STUDY_CONDITIONS.some((condition) => condition === value)
}

export function resolveStudyCondition(value: unknown): StudyCondition {
  return isStudyCondition(value) ? value : 'userlens'
}

export function createStudyRuntimeConfig(
  host: StudyHost,
  condition: StudyCondition = 'userlens'
): StudyRuntimeConfig {
  return { host, condition, ...CONDITION_CONFIGS[condition] }
}

const activeRuntime = shallowRef<StudyRuntimeConfig>(
  createStudyRuntimeConfig('lencanvas', 'userlens')
)

export const studyRuntime = readonly(activeRuntime)

export function getStudyRuntime(): StudyRuntimeConfig {
  return activeRuntime.value
}

export function setStudyRuntime(host: StudyHost, value: unknown): StudyRuntimeConfig {
  const condition = resolveStudyCondition(value)
  const current = activeRuntime.value
  if (current.host === host && current.condition === condition) return current
  const next = createStudyRuntimeConfig(host, condition)
  activeRuntime.value = next
  return next
}
