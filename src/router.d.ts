import 'vue-router'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'

declare module 'vue-router' {
  interface RouteMeta {
    demo?: boolean
    studyHost?: StudyHost
    studyCondition?: StudyCondition
  }
}
