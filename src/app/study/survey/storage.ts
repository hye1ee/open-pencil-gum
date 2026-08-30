import { getStudyRuntime } from '@/app/study/runtime'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'
import { snapshotProposition } from '@/app/study/survey/types'
import type {
  PropositionSnapshot,
  StudyBaselineFile,
  StudySurveySubmission
} from '@/app/study/survey/types'
import { propositions } from '@/app/user-model/store'

const BASELINE_ENDPOINT = '/__study-baseline'
const SURVEY_ENDPOINT = '/__study-survey'

export async function saveStudyBaseline(baseline: StudyBaselineFile): Promise<void> {
  const response = await fetch(BASELINE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseline, null, 2)
  })
  if (!response.ok) {
    throw new Error(`Baseline save failed (${response.status}).`)
  }
}

/** The parsed file before validation; every field untrusted. */
interface RawStudyBaselineFile {
  participantId?: unknown
  host?: unknown
  condition?: unknown
  savedAt?: unknown
  propositions?: unknown
}

function readBaselineSnapshot(item: unknown): PropositionSnapshot | null {
  if (typeof item !== 'object' || item === null) return null
  const raw = item as { id?: unknown; text?: unknown; confidence?: unknown; rationale?: unknown }
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null
  return {
    id: raw.id,
    text: raw.text,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : null
  }
}

export async function fetchStudyBaseline(
  participantId: string,
  host: StudyHost,
  condition: StudyCondition
): Promise<StudyBaselineFile | null> {
  const query = new URLSearchParams({ participant: participantId, host, condition })
  const response = await fetch(`${BASELINE_ENDPOINT}?${query.toString()}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Baseline fetch failed (${response.status}).`)
  const raw = (await response.json()) as RawStudyBaselineFile
  if (!Array.isArray(raw.propositions)) return null
  return {
    participantId,
    host,
    condition,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    propositions: raw.propositions
      .map(readBaselineSnapshot)
      .filter((snapshot): snapshot is PropositionSnapshot => snapshot !== null)
  }
}

export async function submitStudySurvey(submission: StudySurveySubmission): Promise<void> {
  const response = await fetch(SURVEY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission, null, 2)
  })
  if (!response.ok) {
    throw new Error(`Survey save failed (${response.status}).`)
  }
}

/** Snapshot the model that was just injected/seeded as this session's
 * baseline. Called from the study scenario panel right after replacement. */
export async function captureStudyBaselineNow(participantId: string): Promise<void> {
  if (participantId === '') {
    throw new Error('Enter a participant ID before saving the baseline.')
  }
  const runtime = getStudyRuntime()
  await saveStudyBaseline({
    participantId,
    host: runtime.host,
    condition: runtime.condition,
    savedAt: new Date().toISOString(),
    propositions: propositions.value.map(snapshotProposition)
  })
}
