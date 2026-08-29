import { describe, expect, test } from 'bun:test'

import {
  createStudyRuntimeConfig,
  resolveStudyCondition,
  setStudyRuntime
} from '@/app/study/runtime'

describe('study runtime', () => {
  test('defines the UserLens condition for either host', () => {
    expect(createStudyRuntimeConfig('lenchat', 'userlens')).toEqual({
      host: 'lenchat',
      condition: 'userlens',
      metaAgentEnabled: true,
      askUserEnabled: false,
      showRawReasoning: false,
      allowFreeIntervention: false,
      taskAgentUsesUserModel: true,
      updateUserModel: true,
      feedbackExecution: 'silent-retry'
    })
    expect(createStudyRuntimeConfig('lencanvas', 'userlens').host).toBe('lencanvas')
  })

  test('keeps the two baseline conditions isolated from UserLens behavior', () => {
    const askUser = createStudyRuntimeConfig('lenchat', 'ask-user')
    expect(askUser.metaAgentEnabled).toBeFalse()
    expect(askUser.askUserEnabled).toBeTrue()
    expect(askUser.taskAgentUsesUserModel).toBeFalse()
    expect(askUser.feedbackExecution).toBe('tool-resume')

    const userInitiated = createStudyRuntimeConfig('lencanvas', 'user-initiated')
    expect(userInitiated.metaAgentEnabled).toBeFalse()
    expect(userInitiated.askUserEnabled).toBeFalse()
    expect(userInitiated.showRawReasoning).toBeFalse()
    expect(userInitiated.allowFreeIntervention).toBeTrue()
  })

  test('falls back to UserLens for an unknown route condition', () => {
    expect(resolveStudyCondition('unknown')).toBe('userlens')
    expect(setStudyRuntime('lenchat', 'unknown').condition).toBe('userlens')
  })
})
