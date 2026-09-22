import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToolPromptStore } from '@/stores/tool-prompt-store'

export function ToolPromptDialog() {
  const prompt = useToolPromptStore((state) => state.active)
  const answer = useToolPromptStore((state) => state.answer)
  const [response, setResponse] = useState('')

  useEffect(() => setResponse(''), [prompt?.id])

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open && prompt) answer(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
          <DialogDescription className="break-words">{prompt?.description}</DialogDescription>
        </DialogHeader>
        {prompt?.kind === 'question' && (
          <Textarea
            autoFocus
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            placeholder="Your response"
          />
        )}
        <DialogFooter>
          {prompt?.kind === 'question' ? (
            <>
              <Button variant="outline" onClick={() => answer(null)}>
                Dismiss
              </Button>
              <Button onClick={() => answer(response)}>Send response</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => answer('no')}>
                Deny
              </Button>
              <Button onClick={() => answer('yes')}>Approve</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
