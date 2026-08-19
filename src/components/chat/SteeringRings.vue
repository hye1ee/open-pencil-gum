<script setup lang="ts">
import { templateRef, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { STEERABLE_GLYPH, markColor, stepColor } from '@/app/ai/chat/mark-colors'
import {
  beginSteeringFeedback,
  beginUnknownFeedback,
  cancelSteeringFeedback,
  confirmSteeringFeedback,
  editSteeringFeedback,
  mismatch,
  moveSteeringFeedback,
  resumeAfterAnswers,
  setHoveredMark
} from '@/app/ai/chat/mismatch'
import {
  curvePath,
  layoutTimeline,
  positionY,
  TIMELINE_HEIGHT
} from '@/app/ai/chat/steering-layout'
import { useEditorStore } from '@/app/editor/active-store'
import { OPENING_STEP, SPECTRUM, isUnrelated } from '@/app/meta-agent/judge'
import type { SpectrumStep } from '@/app/meta-agent/judge'

const store = useEditorStore()
const scroller = templateRef<HTMLDivElement>('scroller')
const scrollerHeight = ref(0)
let resizeFrame: number | null = null
let pendingHeight = 0
useResizeObserver(scroller, ([entry]) => {
  if (!entry) return
  pendingHeight = entry.contentRect.height
  if (resizeFrame !== null) return
  resizeFrame = requestAnimationFrame(() => {
    scrollerHeight.value = pendingHeight
    resizeFrame = null
  })
})
onBeforeUnmount(() => {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
})
/** Height only. Widths used to scale with it, so the strip got wider as the
 * panel got taller — which decided whether a horizontal scrollbar appeared,
 * which took height back off the measurement. Dragging the panel to that height
 * left the strip shaking one swing per frame. */
const timelineHeight = computed(() => Math.max(TIMELINE_HEIGHT, scrollerHeight.value - 34))
const hoveredPoint = ref<string | null>(null)
interface PendingDrag {
  key: string
  id: string
  startX: number
  startY: number
  active: boolean
}
const pendingDrag = ref<PendingDrag | null>(null)
const DRAG_THRESHOLD = 4
const active = computed(() => new Set(mismatch.marks.map((mark) => mark.id)))
const layout = computed(() => {
  const visible = mismatch.timelineMarks.filter((mark) => !mismatch.hidden.includes(mark.id))
  return layoutTimeline(visible, mismatch.steeringSteps, timelineHeight.value)
})
type TimelinePoint = (typeof layout.value.points)[number]
const segments = computed(() =>
  layout.value.points.slice(1).map((point, index) => {
    const previous = layout.value.points[index]
    return {
      key: `${point.mark.id}:${point.mark.raisedInStep}:${point.mark.raisedOrder}`,
      path: curvePath([previous, point]),
      muted: previous.unknown || point.unknown
    }
  })
)
const latestEvents = computed(() => {
  const latest = new Map<string, TimelinePoint>()
  for (const point of layout.value.points) {
    latest.set(point.mark.lineageId || point.mark.id, point)
  }
  return new Set(latest.values())
})
const revisions = computed(() => {
  const links: Array<{ id: string; from: TimelinePoint; to: TimelinePoint }> = []
  const previous = new Map<string, TimelinePoint>()
  for (const point of layout.value.points) {
    const lineageId = point.mark.lineageId || point.mark.id
    const from = previous.get(lineageId)
    if (from) links.push({ id: `${lineageId}:${point.x}`, from, to: point })
    previous.set(lineageId, point)
  }
  return links
})
const confirmedCount = computed(() => mismatch.answers.filter((answer) => answer.steering).length)
const latestAnswer = computed(() => mismatch.answers.findLast((answer) => answer.steering) ?? null)
const timelineDraft = computed(() =>
  mismatch.steeringDraft?.source === 'timeline' ? mismatch.steeringDraft : null
)
const draftTopic = computed(() => {
  const id = timelineDraft.value?.id
  if (!id) return ''
  return mismatch.timelineMarks.findLast((mark) => mark.id === id)?.topic ?? 'Decision'
})
const preview = computed(() => {
  const draft = mismatch.steeringDraft
  if (!draft || draft.toPosition === null) return null
  const point = layout.value.points.findLast(
    (candidate) => candidate.mark.id === draft.id && latestEvents.value.has(candidate)
  )
  if (!point || !isEditable(point) || draft.toPosition === point.mark.position) return null
  const moved = { ...point, y: positionY(draft.toPosition, timelineHeight.value) }
  return { point, moved }
})

watch(
  () => `${layout.value.steps.at(-1)?.number ?? ''}:${layout.value.points.length}`,
  async (_current, previous) => {
    if (previous === undefined) return
    await nextTick()
    const element = scroller.value
    if (!element) return
    element.scrollTo({ left: element.scrollWidth - element.clientWidth, behavior: 'smooth' })
  }
)

function open(id: string): void {
  const mark = mismatch.timelineMarks.findLast((candidate) => candidate.id === id)
  if (!mark) return
  if (isUnrelated(mark)) beginUnknownFeedback(store, id, 'timeline')
  else beginSteeringFeedback(store, id, 'timeline')
}

function editLatestAnswer(): void {
  const answer = latestAnswer.value
  if (answer) open(answer.id)
}

function clickPoint(point: TimelinePoint): void {
  if (point.unknown && isEditable(point)) open(point.mark.id)
}

function editDraft(event: Event): void {
  if (event.target instanceof HTMLInputElement) editSteeringFeedback(event.target.value)
}

function isCurrent(point: TimelinePoint): boolean {
  return (
    point.mark.raisedInStep === layout.value.steps.at(-1)?.number &&
    latestEvents.value.has(point) &&
    active.value.has(point.mark.id)
  )
}

function isEditable(point: TimelinePoint): boolean {
  return isCurrent(point)
}

function pointOpacity(point: TimelinePoint): number {
  // Before the hover check: the pointer is still over the mark being dragged.
  if (preview.value?.point === point) return 0.18
  if (hoveredPoint.value === pointKey(point)) return 1
  if (isCurrent(point)) return 1
  return latestEvents.value.has(point) ? 0.48 : 0.28
}

function regionMaskId(key: string): string {
  return `steering-region-${key.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** Flipped once the first frame is on screen so the bands open from zero. After
 * that every width change animates from wherever the band already was. */
const revealed = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    revealed.value = true
  })
})

function pointColor(point: TimelinePoint): string {
  if (!latestEvents.value.has(point)) return '#aaa69f'
  return markColor(point.mark)
}

/** The destination's colour: the position is what the colour means now, so the
 * preview has to move with it as they drag. */
function previewColor(): string {
  return stepColor(mismatch.steeringDraft?.toPosition ?? null)
}

function pointKey(point: TimelinePoint): string {
  return `${point.mark.id}:${point.mark.raisedInStep}:${point.mark.raisedOrder}`
}

function pointTopic(point: TimelinePoint): string {
  const topic = point.mark.topic || 'Decision'
  return topic.length > 22 ? `${topic.slice(0, 21)}…` : topic
}

function pointSummary(point: TimelinePoint): string {
  return point.mark.notes.at(-1)?.text.split('·')[0]?.trim() ?? pointTopic(point)
}

function tooltipY(point: TimelinePoint): number {
  return point.y < 76 ? point.y + 28 : Math.max(2, point.y - 74)
}

function tooltipX(point: TimelinePoint): number {
  return Math.min(layout.value.width - 306, Math.max(6, point.x - 150))
}

function enterPoint(point: TimelinePoint): void {
  hoveredPoint.value = pointKey(point)
  setHoveredMark(store, point.mark.id, isEditable(point))
}

function leavePoint(): void {
  if (pendingDrag.value?.active) return
  hoveredPoint.value = null
  setHoveredMark(store, null)
}

function stepFromPointer(event: PointerEvent): SpectrumStep {
  const svg = (event.currentTarget as Element).closest('svg')
  if (!(svg instanceof SVGSVGElement)) return OPENING_STEP
  const bounds = svg.getBoundingClientRect()
  const y = ((event.clientY - bounds.top) / bounds.height) * (timelineHeight.value + 34)
  return SPECTRUM.reduce((closest, step) =>
    Math.abs(positionY(step, timelineHeight.value) - y) <
    Math.abs(positionY(closest, timelineHeight.value) - y)
      ? step
      : closest
  )
}

function startPointDrag(event: PointerEvent, point: TimelinePoint): void {
  if (point.unknown || !isEditable(point)) return
  pendingDrag.value = {
    key: pointKey(point),
    id: point.mark.id,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  }
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId)
}

function movePointDrag(event: PointerEvent): void {
  const drag = pendingDrag.value
  if (!drag) return
  if (!drag.active) {
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
    if (distance < DRAG_THRESHOLD) return
    drag.active = true
    hoveredPoint.value = drag.key
    setHoveredMark(store, null)
    open(drag.id)
  }
  moveSteeringFeedback(stepFromPointer(event))
}

function stopPointDrag(): void {
  const drag = pendingDrag.value
  pendingDrag.value = null
  if (drag && !drag.active) {
    hoveredPoint.value = null
    setHoveredMark(store, null)
    open(drag.id)
  }
}

function revisionOpacity(revision: { from: TimelinePoint; to: TimelinePoint }): number {
  const hovered = hoveredPoint.value
  if (hovered === pointKey(revision.from) || hovered === pointKey(revision.to)) return 0.72
  return 0.28
}

function revisionPath(from: TimelinePoint, to: TimelinePoint): string {
  const middle = (from.x + to.x) / 2
  const bendsDown = Math.min(from.y, to.y) < 50
  const offset = bendsDown ? 11 : -11
  const bend = bendsDown ? Math.max(from.y, to.y) + 28 : Math.min(from.y, to.y) - 28
  return `M ${from.x} ${from.y + offset} Q ${middle} ${bend}, ${to.x} ${to.y + offset}`
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-panel text-surface">
    <header class="flex min-h-9 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <div class="flex shrink-0 items-center gap-1.5">
        <span
          class="flex size-5 items-center justify-center rounded-full bg-[#eeeafd] text-[#7464d9] ring-1 ring-[#d8d1f5]"
        >
          <icon-lucide-route class="size-3" />
        </span>
        <span class="text-xs font-semibold">Steering Space</span>
      </div>
      <template v-if="timelineDraft">
        <span class="max-w-28 truncate text-[10px] font-medium text-muted">
          {{ draftTopic }}
        </span>
        <input
          :value="timelineDraft.text"
          class="h-7 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-[11px] text-surface outline-none focus:border-[#8f857b]"
          aria-label="Feedback"
          @input="editDraft"
        />
        <button
          class="shrink-0 rounded-md px-2 py-1.5 text-[10px] text-muted hover:bg-hover"
          @click="cancelSteeringFeedback(store)"
        >
          Cancel
        </button>
        <button
          class="shrink-0 rounded-md bg-surface px-2.5 py-1.5 text-[10px] text-white hover:bg-[#403d38]"
          @click="confirmSteeringFeedback(store)"
        >
          Confirm
        </button>
      </template>
      <template v-else-if="latestAnswer">
        <span class="max-w-32 truncate text-[10px] font-medium text-[#625d57]">
          {{ latestAnswer.topic }}
        </span>
        <span class="text-[10px] text-[#8a847d]"> Saved </span>
        <button
          class="rounded-md px-2 py-1 text-[10px] text-[#625d57] hover:bg-hover"
          @click="editLatestAnswer"
        >
          Edit
        </button>
      </template>
      <button
        v-if="!timelineDraft && confirmedCount > 0"
        class="ml-auto shrink-0 rounded-md bg-surface px-2.5 py-1.5 text-[10px] text-white hover:bg-[#403d38]"
        @click="resumeAfterAnswers"
      >
        Apply feedback and continue
      </button>
    </header>
    <div class="relative min-h-0 flex-1">
      <div ref="scroller" class="h-full overflow-x-auto overflow-y-hidden">
        <Transition
          appear
          enter-active-class="transition-opacity duration-[1200ms] ease-out"
          enter-from-class="opacity-0"
        >
          <svg
            v-if="layout.steps.length > 0"
            :width="layout.width"
            :height="timelineHeight + 34"
            class="block min-w-full"
          >
            <defs>
              <!-- The scale: the app accent at the user-model end, the agent's own
                   cursor blue at the other. Neither is the good one. -->
              <linearGradient id="rated-region" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ddd8f5" stop-opacity="0.72" />
                <stop offset="49%" stop-color="#f1eff9" stop-opacity="0.6" />
                <stop offset="51%" stop-color="#eef3fd" stop-opacity="0.6" />
                <stop offset="100%" stop-color="#d6e4fb" stop-opacity="0.72" />
              </linearGradient>
              <mask
                v-for="region in layout.regions"
                :id="regionMaskId(region.key)"
                :key="region.key"
                maskUnits="userSpaceOnUse"
                :x="region.start"
                y="0"
                :width="region.end - region.start"
                :height="timelineHeight"
              >
                <!-- CSS, not `<animate fill="freeze">`: a frozen SMIL run holds the
                     width it ended on, so a band that later grows keeps its old
                     edge and leaves a pale stripe behind. -->
                <rect
                  :x="region.start"
                  y="0"
                  :width="revealed ? region.end - region.start : 0"
                  :height="timelineHeight"
                  fill="white"
                  class="transition-[width] duration-[1200ms] ease-out"
                />
              </mask>
              <marker
                id="revision-arrow"
                viewBox="0 0 6 6"
                refX="5"
                refY="3"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 0 L 6 3 L 0 6 Z" fill="#9b9198" />
              </marker>
              <mask
                v-for="(revision, index) in revisions"
                :id="`revision-draw-${index}`"
                :key="revision.id"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                :width="layout.width"
                :height="timelineHeight"
              >
                <path
                  :d="revisionPath(revision.from, revision.to)"
                  pathLength="1"
                  fill="none"
                  stroke="white"
                  stroke-width="5"
                  stroke-dasharray="1"
                  stroke-dashoffset="1"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="1"
                    to="0"
                    dur="1500ms"
                    fill="freeze"
                  />
                </path>
              </mask>
            </defs>

            <TransitionGroup
              appear
              tag="g"
              enter-active-class="transition-opacity duration-[1200ms] ease-out"
              enter-from-class="opacity-0"
            >
              <rect
                v-for="region in layout.regions"
                :key="region.key"
                :x="region.start"
                y="0"
                :width="region.end - region.start"
                :height="timelineHeight"
                :fill="region.kind === 'unknown' ? 'var(--color-hover)' : 'url(#rated-region)'"
                :mask="`url(#${regionMaskId(region.key)})`"
                shape-rendering="crispEdges"
              />
            </TransitionGroup>
            <TransitionGroup appear tag="g">
              <path
                v-for="segment in segments"
                :key="segment.key"
                :d="segment.path"
                pathLength="1"
                fill="none"
                stroke="currentColor"
                :stroke-width="segment.muted ? 0.8 : 1.25"
                stroke-dasharray="1"
                stroke-dashoffset="1"
                :opacity="segment.muted ? 0.18 : 0.42"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="1"
                  to="0"
                  dur="1500ms"
                  fill="freeze"
                />
              </path>
            </TransitionGroup>
            <TransitionGroup
              appear
              tag="g"
              enter-active-class="transition-opacity duration-[1200ms] ease-out"
              enter-from-class="opacity-0"
            >
              <path
                v-for="(revision, index) in revisions"
                :key="revision.id"
                :d="revisionPath(revision.from, revision.to)"
                fill="none"
                stroke="#9b9198"
                stroke-width="1.25"
                stroke-dasharray="4 4"
                marker-end="url(#revision-arrow)"
                :opacity="revisionOpacity(revision)"
                :mask="`url(#revision-draw-${index})`"
              />
            </TransitionGroup>

            <g v-if="preview" class="pointer-events-none">
              <circle
                :cx="preview.moved.x"
                :cy="preview.moved.y"
                r="11"
                fill="var(--color-panel)"
                :stroke="previewColor()"
                stroke-width="2"
              />
              <path
                :transform="`translate(${preview.moved.x} ${preview.moved.y})`"
                :d="STEERABLE_GLYPH"
                fill="none"
                :stroke="previewColor()"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </g>

            <TransitionGroup
              appear
              tag="g"
              enter-active-class="transition-opacity duration-[1200ms] ease-out"
              enter-from-class="opacity-0"
            >
              <g
                v-for="point in layout.points"
                :key="pointKey(point)"
                :transform="`translate(${point.x} ${point.y})`"
                :class="isEditable(point) ? 'cursor-pointer' : 'cursor-default'"
                @click="clickPoint(point)"
                @pointerdown="startPointDrag($event, point)"
                @pointermove="movePointDrag"
                @pointerup="stopPointDrag"
                @pointercancel="stopPointDrag"
                @pointerenter="enterPoint(point)"
                @pointerleave="leavePoint"
              >
                <circle
                  r="10"
                  fill="var(--color-panel)"
                  :stroke="pointColor(point)"
                  :stroke-opacity="pointOpacity(point)"
                  stroke-width="2"
                />
                <path
                  v-if="!point.unknown"
                  :d="STEERABLE_GLYPH"
                  fill="none"
                  :stroke="pointColor(point)"
                  :stroke-opacity="pointOpacity(point)"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <text
                  v-else
                  y="4"
                  text-anchor="middle"
                  :fill-opacity="pointOpacity(point)"
                  class="fill-muted text-[11px] font-bold"
                >
                  ?
                </text>
                <text
                  y="-16"
                  text-anchor="middle"
                  :fill-opacity="pointOpacity(point)"
                  class="fill-[#5f5b55] text-[9px] font-medium"
                >
                  {{ pointTopic(point) }}
                </text>
              </g>
            </TransitionGroup>

            <g
              v-for="point in layout.points"
              v-show="hoveredPoint === pointKey(point) && !mismatch.steeringDraft"
              :key="`tooltip:${pointKey(point)}`"
              class="pointer-events-none"
            >
              <foreignObject :x="tooltipX(point)" :y="tooltipY(point)" width="300" height="82">
                <div
                  class="rounded-md border border-border bg-panel px-2 py-1.5 text-center shadow-sm"
                >
                  <p class="text-[11px] leading-snug font-semibold text-[#504b45]">
                    {{ point.mark.topic || 'Decision' }}
                  </p>
                  <p class="mt-1 text-[10px] leading-snug text-muted">
                    {{ pointSummary(point) }}
                  </p>
                </div>
              </foreignObject>
            </g>

            <TransitionGroup
              appear
              tag="g"
              enter-active-class="transition-opacity duration-[1200ms] ease-out"
              enter-from-class="opacity-0"
            >
              <g v-for="step in layout.steps" :key="step.number">
                <line
                  v-if="step.start > 0"
                  :x1="step.start"
                  :x2="step.start"
                  y1="0"
                  :y2="timelineHeight + 34"
                  stroke="currentColor"
                  stroke-dasharray="3 4"
                  opacity="0.28"
                />
                <text
                  :x="(step.start + step.end) / 2"
                  :y="timelineHeight + 21"
                  text-anchor="middle"
                  class="fill-muted text-[10px]"
                >
                  {{ step.label }}
                </text>
              </g>
            </TransitionGroup>
          </svg>
        </Transition>
      </div>
      <div
        class="pointer-events-none absolute top-0 left-0 flex w-28 flex-col items-center justify-between bg-panel py-2 text-center whitespace-nowrap"
        :style="{ height: `${timelineHeight}px` }"
      >
        <span
          class="w-[104px] rounded-full border border-[#6b5bd6]/35 bg-[#6b5bd6]/10 px-2 py-1.5 text-[11px] leading-none font-semibold text-[#6b5bd6]"
        >
          User model
        </span>
        <span
          class="w-[104px] rounded-full border border-[#4285f5]/35 bg-[#4285f5]/10 px-2 py-1.5 text-[11px] leading-none font-semibold text-[#4285f5]"
        >
          Agent reasoning
        </span>
      </div>
    </div>
  </div>
</template>
