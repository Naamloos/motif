import type { ChatImage, ChatMessage } from '@/stores/app-model'

export type AgentToolContext = {
  chatId: string
  abortSignal: AbortSignal
  folder?: string
  images: ChatImage[]
  getChats: () => Array<{ id: string; title: string; messages: ChatMessage[] }>
  getTasks: (chatId: string) => Array<{ id: string; text: string; complete: boolean }>
  requestApproval: (title: string, description: string) => Promise<boolean>
  askUser: (question: string) => Promise<string | null>
  addTask: (chatId: string, task: string) => string
  completeTask: (chatId: string, taskId: string) => boolean
  saveMemory: (memory: string) => void
  listMemories: () => string[]
  removeMemory: (memory: string) => boolean
  updateMemory: (memory: string, replacement: string) => boolean
  requireApprovalForFileChanges: boolean
  requireApprovalForMcpTools: boolean
  requireApprovalForCommands: boolean
  requireApprovalForBrowser: boolean
}
