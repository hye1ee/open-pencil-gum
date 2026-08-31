import type { PropositionChangeLabel, SurveyRatingMetric } from '@/app/study/survey/types'

/** Everything a researcher may want to reword lives in this file. */

export const SURVEY_SCALE_POINTS = 7
export const SURVEY_SCALE_MINIMUM_LABEL_KOREAN = '전혀 그렇지 않다'
export const SURVEY_SCALE_MAXIMUM_LABEL_KOREAN = '매우 그렇다'

export interface SurveyQuestionDefinition {
  metric: SurveyRatingMetric
  questionKorean: string
}

export const PROPOSITION_QUESTIONS_BY_LABEL: Record<
  PropositionChangeLabel,
  SurveyQuestionDefinition[]
> = {
  expansion: [
    { metric: 'accuracy', questionKorean: '이 새 proposition은 나를 정확하게 반영한다.' },
    {
      metric: 'depth',
      questionKorean: '이 새 proposition은 나의 의미 있는 측면을 깊이 있게 담고 있다.'
    }
  ],
  refinement: [
    {
      metric: 'accuracy',
      questionKorean: '이 수정은 원래 proposition보다 나를 더 정확하게 표현한다.'
    },
    { metric: 'depth', questionKorean: '이 수정은 나에 대한 이해를 더 깊이 있게 만든다.' }
  ],
  recalibration: [
    {
      metric: 'accuracy',
      questionKorean: '이 확신도 변화는 이 proposition이 나에게 적용되는 정도를 적절하게 반영한다.'
    }
  ],
  retention: [
    { metric: 'accuracy', questionKorean: '이 proposition을 그대로 유지한 것은 적절하다.' }
  ],
  rationale: [
    {
      metric: 'accuracy',
      questionKorean: '이 rationale은 이 proposition이 나에게 해당하는 이유를 정확하게 설명한다.'
    },
    { metric: 'depth', questionKorean: '이 rationale은 나의 이유를 깊이 있게 담아낸다.' }
  ]
}

export const WHOLE_MODEL_QUESTIONS: SurveyQuestionDefinition[] = [
  { metric: 'accuracy', questionKorean: '이 유저 모델은 나를 정확하게 표현한다.' },
  { metric: 'depth', questionKorean: '이 유저 모델은 나를 깊이 있게 표현한다.' }
]

export interface FeedbackMethodQuestionDefinition {
  key: string
  questionKorean: string
}

export const FEEDBACK_METHOD_QUESTIONS: FeedbackMethodQuestionDefinition[] = [
  {
    key: 'tacit-knowledge-expression',
    questionKorean:
      '이 피드백 방식은 내가 암묵적으로 알고 있던 것을 더 효과적으로 표현하도록 도와주었다.'
  },
  {
    key: 'mental-effort',
    questionKorean: '이 방식으로 피드백을 주는 것은 정신적 노력이 많이 들었다.'
  },
  {
    key: 'want-awareness',
    questionKorean: '이 피드백 방식은 내가 무엇을 원하는지 더 잘 인식하게 해주었다.'
  }
]

export type OutputQualityQuestionKey =
  | 'request-fulfillment'
  | 'overall-quality'
  | 'preference-alignment'
  | 'implicit-knowledge-alignment'

export interface OutputQualityQuestionDefinition {
  key: OutputQualityQuestionKey
  questionKorean: string
}

/** Asked after every finished hands-off run, on the shared 7-point scale. */
export const OUTPUT_QUALITY_QUESTIONS: OutputQualityQuestionDefinition[] = [
  {
    key: 'request-fulfillment',
    questionKorean: '이 결과물은 내가 요청한 내용을 정확히 수행했다.'
  },
  { key: 'overall-quality', questionKorean: '이 결과물의 전반적인 품질이 높다.' },
  {
    key: 'preference-alignment',
    questionKorean: '이 결과물은 나의 취향과 선호를 잘 반영하고 있다.'
  },
  {
    key: 'implicit-knowledge-alignment',
    questionKorean:
      '이 결과물은 나의 암묵적인 지식(명시적으로 말하지 않은 기준이나 노하우)을 잘 반영하고 있다.'
  }
]

export interface PropositionChangeLabelPresentation {
  displayName: string
  chipClasses: string
}

export const LABEL_PRESENTATION: Record<PropositionChangeLabel, PropositionChangeLabelPresentation> =
  {
    retention: {
      displayName: 'Retention',
      chipClasses: 'border-teal-200 bg-teal-50 text-teal-700'
    },
    recalibration: {
      displayName: 'Recalibration',
      chipClasses: 'border-green-200 bg-green-50 text-green-700'
    },
    refinement: {
      displayName: 'Refinement',
      chipClasses: 'border-orange-200 bg-orange-50 text-orange-700'
    },
    rationale: {
      displayName: 'Rationale',
      chipClasses: 'border-blue-200 bg-blue-50 text-blue-700'
    },
    expansion: {
      displayName: 'Expansion',
      chipClasses: 'border-red-200 bg-red-50 text-red-700'
    }
  }
