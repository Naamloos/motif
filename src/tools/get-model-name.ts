import { tool } from 'ai'
import z from 'zod'

export default function getModelName(modelName: string) {
  return tool({
    description: 'Get the name of the current LLM/AI model being used',
    inputSchema: z.object({}),
    execute: async () => modelName,
  })
}
