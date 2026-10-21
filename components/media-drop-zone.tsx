"use client"

import { cn } from "@/lib/utils"
import { Upload } from "lucide-react"
import { motion } from "motion/react"
import { useId, useRef, useState } from "react"

type MediaDropZoneProps = {
  onFiles: (files: File[]) => void
  disabled?: boolean
  videoDisabledMessage?: string | null
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,video/mp4,video/quicktime,.mp4,.mov"

export function MediaDropZone({ onFiles, disabled = false, videoDisabledMessage }: MediaDropZoneProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const takeFiles = (list: FileList | null) => {
    if (disabled || !list?.length) return
    onFiles(Array.from(list))
  }

  return (
    <div
      role="group"
      aria-labelledby={`${inputId}-label`}
      className={cn(
        "relative rounded-xl border-[1.5px] border-dashed bg-[linear-gradient(180deg,rgba(88,101,242,0.06),transparent_70%)] px-4 py-9 text-center transition-colors sm:px-6",
        "focus-within:ring-[3px] focus-within:ring-ring/50",
        isDragOver ? "border-brand bg-[rgba(88,101,242,0.12)]" : "border-[#4a4e57] hover:border-brand/60",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragOver(true)
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
        accept={ACCEPT}
        multiple
        disabled={disabled}
        tabIndex={-1}
        aria-label="Images and videos"
        onChange={(event) => {
          takeFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <div className="mx-auto mb-3.5 grid size-[52px] place-items-center rounded-[14px] bg-[rgba(88,101,242,0.15)]">
        <Upload className="size-[26px] text-brand-text" aria-hidden="true" strokeWidth={2} />
      </div>
      <h3 id={`${inputId}-label`} className="text-lg font-bold tracking-[-0.01em] text-foreground">
        Drop images or videos
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        JPEG, PNG, WebP · MP4 or iPhone MOV · multiple files OK
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-[18px] inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#3c45a5] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-auto"
        aria-controls={inputId}
      >
        Browse files
      </button>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Images over 20 MiB shrink in your browser. Videos upload to Shrinkcord for compression (max 500 MiB, 10 min).
      </p>
      {videoDisabledMessage ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {videoDisabledMessage}
        </p>
      ) : null}
      {isDragOver ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80"
        >
          <p className="font-mono text-sm text-brand-text">Drop to add files</p>
        </motion.div>
      ) : null}
    </div>
  )
}
