import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from 'cn'

function Progress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  const progress = value === null ? 0 : Math.min(100, Math.max(0, value))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <ProgressPrimitive.Track className="size-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="size-full bg-primary transition-transform"
          style={{ transform: `translateX(-${100 - progress}%)` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
