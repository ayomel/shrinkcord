"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/discord-file-limit", label: "Discord file limit" },
  { href: "/#faq", label: "FAQ" },
]

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[rgba(24,25,28,0.9)] backdrop-blur-[12px]">
      <div className="mx-auto flex h-[60px] w-full max-w-[1160px] items-center justify-between gap-4 px-[18px] sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-bold tracking-[-0.01em] text-foreground"
        >
          <span
            className="grid size-6 place-items-center rounded-[7px] bg-brand"
            aria-hidden="true"
          >
            <span className="size-2.5 scale-90 rounded-[3px] border-2 border-white" />
          </span>
          Shrinkcord
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-7 sm:flex">
          {links.map((link) => {
            const active = link.href === "/discord-file-limit" && pathname === "/discord-file-limit"
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  active && "text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
