import type { ChatImage, ChatMessage } from '@/stores/app-model'

export type AgentToolContext = {
  chatId: string
  folder?: string
  images: ChatImage[]
  getChats: () => Array<{ id: string; title: string; messages: ChatMessage[] }>
  getTasks: (chatId: string) => Array<{ id: string; text: string; complete: boolean }>
  requestApproval: (title: string, description: string) => Promise<boolean>
  askUser: (question: string) => Promise<string | null>
  addTask: (chatId: string, task: string) => string
  completeTask: (chatId: string, taskId: string) => boolean
  saveMemory: (memory: string) => void
}
