import type { ReactNode } from 'react'

export const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm'

export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export function Field({
  label,
  description,
  horizontal = false,
  children,
}: {
  label: string
  description?: string
  horizontal?: boolean
  children: ReactNode
}) {
  return (
    <label className={horizontal ? 'flex items-center justify-between gap-4' : 'block space-y-2'}>
      <span className={horizontal ? 'min-w-0' : 'block'}>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      {children}
    </label>
  )
}
