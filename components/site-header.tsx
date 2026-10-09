"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/discord-file-limit", label: "File limit" },
]

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[rgba(30,31,34,0.92)] backdrop-blur-[12px]">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-4 px-4">
        <Link href="/" className="text-sm font-semibold tracking-[-0.01em] text-foreground">
          Shrinkcord
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5">
          {links.map((link) => {
            const active = link.href === "/discord-file-limit" && pathname === "/discord-file-limit"
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  active && "border-b border-primary text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        <Button asChild className="hidden sm:inline-flex">
          <Link href="/#shrink">Shrink an image</Link>
        </Button>
      </div>
    </header>
  )
}
