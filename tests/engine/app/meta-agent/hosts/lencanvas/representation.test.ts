import { describe, expect, test } from 'bun:test'

import type { CodeVisualArtifact, FeedbackNote } from '@/app/meta-agent/core/types'
import { createOpenPencilRepresentationProvider } from '@/app/meta-agent/hosts/lencanvas/representation'

const ARTIFACT: CodeVisualArtifact = {
  format: 'html',
  srcdoc: '<!doctype html><html></html>',
  targets: [{ id: 'primary', label: 'Primary' }]
}

function noteWith(representation: FeedbackNote['representation']): FeedbackNote {
  return {
    id: 'note-1',
    originStep: 3,
    originChunk: 2,
    topic: 'button-hierarchy',
    relationship: 'alignment',
    representation,
    representationGoal: 'Clarify the intended hierarchy.',
    text: 'The primary action carries the strongest emphasis.',
    cueSegments: [],
    nodeId: null,
    evidenceFromReasoning: 'The primary action carries the strongest emphasis.',
    propositionIds: []
  }
}

describe('OpenPencil Meta Agent representation provider', () => {
  test('passes text through without invoking a visual generator', async () => {
    let visualCalls = 0
    const provider = createOpenPencilRepresentationProvider({
      composeCodeVisual: async () => {
        visualCalls++
        return ARTIFACT
      },
      generateImage: async () => {
        visualCalls++
        return 'data:image/jpeg;base64,image'
      }
    })

    expect(await provider.materialize(noteWith({ type: 'text' }))).toEqual({ type: 'text' })
    expect(visualCalls).toBe(0)
  })

  test('routes code-visual through the HTML/SVG composer', async () => {
    let composedNoteId: string | null = null
    const provider = createOpenPencilRepresentationProvider({
      composeCodeVisual: async (note) => {
        composedNoteId = note.id
        return ARTIFACT
      },
      generateImage: async () => 'data:image/jpeg;base64,image'
    })
    const note = noteWith({
      type: 'code-visual',
      visualType: 'artifact',
      brief: {
        subject: 'Primary button',
        decision: 'How much emphasis it should carry',
        alternatives: [],
        mustShow: ['Primary action'],
        formatHint: 'html'
      },
      artifact: null,
      status: 'loading'
    })

    expect(await provider.materialize(note)).toEqual({ type: 'code-visual', artifact: ARTIFACT })
    expect(composedNoteId).toBe('note-1')
  })

  test('routes image through the image generator with its complete brief', async () => {
    let imageArguments: string[] = []
    const provider = createOpenPencilRepresentationProvider({
      composeCodeVisual: async () => ARTIFACT,
      generateImage: async (prompt, imageType, goal) => {
        imageArguments = [prompt, imageType, goal]
        return 'data:image/jpeg;base64,image'
      }
    })
    const note = noteWith({
      type: 'image',
      imageType: 'illustration',
      prompt: 'A crescent moon above a quiet bed.',
      url: null,
      status: 'loading'
    })

    expect(await provider.materialize(note)).toEqual({
      type: 'image',
      url: 'data:image/jpeg;base64,image'
    })
    expect(imageArguments).toEqual([
      'A crescent moon above a quiet bed.',
      'illustration',
      'Clarify the intended hierarchy.'
    ])
  })
})
