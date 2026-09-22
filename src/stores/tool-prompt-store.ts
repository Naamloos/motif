import { create } from 'zustand'

type ToolPrompt = {
  id: string
  title: string
  description: string
  kind: 'approval' | 'question'
  resolve: (answer: string | null) => void
}

type ToolPromptState = {
  active: ToolPrompt | null
  askApproval: (title: string, description: string) => Promise<boolean>
  askQuestion: (title: string, description: string) => Promise<string | null>
  answer: (answer: string | null) => void
}

const queue: ToolPrompt[] = []

function showNext(set: (state: Partial<ToolPromptState>) => void) {
  if (!useToolPromptStore.getState().active) set({ active: queue.shift() ?? null })
}

export const useToolPromptStore = create<ToolPromptState>((set) => ({
  active: null,
  askApproval: (title, description) =>
    new Promise((resolve) => {
      queue.push({
        id: crypto.randomUUID(),
        title,
        description,
        kind: 'approval',
        resolve: (answer) => resolve(answer === 'yes'),
      })
      showNext(set)
    }),
  askQuestion: (title, description) =>
    new Promise((resolve) => {
      queue.push({ id: crypto.randomUUID(), title, description, kind: 'question', resolve })
      showNext(set)
    }),
  answer: (answer) => {
    const current = useToolPromptStore.getState().active
    if (!current) return
    set({ active: null })
    current.resolve(answer)
    queueMicrotask(() => showNext(set))
  },
}))
