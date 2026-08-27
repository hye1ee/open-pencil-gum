export interface ChatProposition {
  id: string
  text: string
  confidence: number
  decay: number
  reasoning: string
  rationale: string | null
  rationaleGrounds: string | null
  rationaleFrom: string[]
  createdAt: string
  updatedAt: string
  observations: number
  embedding: number[]
  originalText: string
  originalEmbedding: number[]
  revisions: number
}
