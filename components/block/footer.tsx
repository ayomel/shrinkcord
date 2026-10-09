import { Separator } from "@/components/ui/separator"

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#shrink", label: "Shrink an image" },
      { href: "/discord-file-limit", label: "Discord file limit" },
    ],
  },
  {
    title: "Guide",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Limits",
    links: [
      { href: "/discord-file-limit#free", label: "Free, 20 MB" },
      { href: "/discord-file-limit#nitro", label: "Nitro" },
      { href: "/discord-file-limit#boosts", label: "Server boosts" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="max-w-xs">
          <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">Shrinkcord</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Shrink images that are over Discord&apos;s free 20 MB upload limit. Processing stays in
            the browser.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {column.title}
            </h2>
            <ul className="mt-4 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Separator />
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Shrinkcord</p>
        <p>Shrinkcord is not affiliated with Discord.</p>
      </div>
    </footer>
  )
}
