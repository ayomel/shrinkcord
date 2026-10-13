"use client"

import { acceptedType } from "@/lib/limits"
import { cn } from "@/lib/utils"
import { AlertCircle, Upload } from "lucide-react"
import { motion } from "motion/react"
import { useId, useRef, useState } from "react"

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
        "relative rounded-xl border-[1.5px] border-dashed bg-[linear-gradient(180deg,rgba(88,101,242,0.06),transparent_70%)] px-4 py-9 text-center transition-colors sm:px-6",
        isDragOver ? "border-brand bg-[rgba(88,101,242,0.12)]" : "border-[#4a4e57] hover:border-brand/60",
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
      <div className="mx-auto mb-3.5 grid size-[52px] place-items-center rounded-[14px] bg-[rgba(88,101,242,0.15)]">
        <Upload className="size-[26px] text-brand-text" aria-hidden="true" strokeWidth={2} />
      </div>
      <h3 className="text-lg font-bold tracking-[-0.01em] text-foreground">
        Drop images over 20 MB
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        JPEG, PNG, or WebP · multiple files OK
      </p>
      <label
        htmlFor={inputId}
        className="mt-[18px] inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#3c45a5] sm:w-auto"
      >
        Choose images
      </label>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Files at or under 20 MB are returned unchanged.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-3 inline-flex items-center justify-center gap-1.5 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {isDragOver ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80"
        >
          <p className="font-mono text-sm text-brand-text">Drop to shrink</p>
        </motion.div>
      ) : null}
    </div>
  )
}
