"use client"

import { acceptedType } from "@/lib/limits"
import { cn } from "@/lib/utils"
import { ImageIcon } from "lucide-react"
import { motion } from "motion/react"
import { useId, useRef, useState } from "react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

type FileInputProps = {
  accept?: string
  allowMultiple?: boolean
  onFileChange?: (files: File[]) => void
}

export default function FileInput({
  accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  allowMultiple = true,
  onFileChange,
}: FileInputProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const takeFiles = (list: FileList | null) => {
    if (!list?.length) return
    const accepted: File[] = []
    const rejected: string[] = []

    for (const file of Array.from(list)) {
      if (acceptedType(file)) accepted.push(file)
      else rejected.push(file.name)
    }

    setError(
      rejected.length
        ? `${rejected.join(", ")} needs to be a JPEG, PNG, or WebP.`
        : null,
    )
    if (accepted.length) onFileChange?.(accepted)
  }

  return (
    <div
      className={cn(
        "relative min-h-56 rounded-lg border border-dashed bg-muted transition-colors",
        isDragOver ? "border-primary bg-primary/10" : "border-border hover:border-accent",
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        setIsDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsDragOver(false)
        takeFiles(event.dataTransfer.files)
      }}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={allowMultiple}
        onChange={(event) => {
          takeFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <Empty className="min-h-56 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageIcon />
          </EmptyMedia>
          <EmptyTitle className="text-base font-semibold tracking-[-0.01em]">
            Drop images over 20 MB
          </EmptyTitle>
          <EmptyDescription>
            JPEG, PNG, and WebP. Files already at or under 20 MB stay as they are.
          </EmptyDescription>
        </EmptyHeader>
        <label
          htmlFor={inputId}
          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#4752c4]"
        >
          Choose images
        </label>
      </Empty>
      {error ? (
        <p role="alert" className="px-6 pb-5 text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {isDragOver ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80"
        >
          <p className="font-mono text-sm text-primary">Drop to shrink</p>
        </motion.div>
      ) : null}
    </div>
  )
}
