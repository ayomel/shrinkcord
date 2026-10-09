import { JsonLd } from "@/components/json-ld"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { site } from "@/lib/site"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: site.limitTitle,
  description: site.limitDescription,
  alternates: {
    canonical: "/discord-file-limit",
  },
  openGraph: {
    title: `${site.limitTitle} · Shrinkcord`,
    description: site.limitDescription,
    url: "/discord-file-limit",
    type: "article",
  },
}

const rows = [
  ["Free", "20 MB", "Every server and DM"],
  ["Nitro Basic", "50 MB", "Follows your account"],
  ["Nitro", "Up to 1 GB", "Follows your account"],
  ["Server boost level 2", "50 MB", "That server only"],
  ["Server boost level 3", "100 MB", "That server only"],
]

export default function DiscordFileLimitPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-12 md:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: site.limitTitle,
          description: site.limitDescription,
          datePublished: "2026-10-09",
          dateModified: "2026-10-09",
          author: { "@type": "Organization", name: "Shrinkcord" },
          publisher: { "@type": "Organization", name: "Shrinkcord" },
          mainEntityOfPage: `${site.url}/discord-file-limit`,
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Shrinkcord", item: site.url },
            {
              "@type": "ListItem",
              position: 2,
              name: "Discord file size limit",
              item: `${site.url}/discord-file-limit`,
            },
          ],
        }}
      />

      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Shrinkcord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Discord file size limit</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <p className="mt-8 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-primary uppercase">
        Updated October 9, 2026
      </p>
      <h1 className="mt-3 text-[clamp(2rem,4vw,3.5rem)] leading-none font-semibold tracking-[-0.035em] text-foreground">
        Discord file size limit
      </h1>
      <p className="mt-5 text-base leading-relaxed text-muted-foreground">
        A free Discord account can attach 20 MB per file. That number changed in August 2026, up
        from 10 MB, and it is the reason Shrinkcord targets 19.5 MB. The figures below are taken
        from Discord&apos;s own help center, not from older roundups.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Per file</TableHead>
              <TableHead>Where it applies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row[0]}>
                {row.map((cell) => (
                  <TableCell key={cell}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Source:{" "}
        <a
          href="https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ"
          className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
        >
          Discord File Attachments FAQ
        </a>
        . Nitro prices and perk names are described on{" "}
        <a
          href="https://support.discord.com/hc/en-us/articles/115000435108-What-are-Nitro-Nitro-Basic"
          className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
        >
          Discord&apos;s Nitro page
        </a>
        .
      </p>

      <h2
        id="free"
        className="mt-12 scroll-mt-24 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.05] font-semibold tracking-[-0.03em]"
      >
        The free cap is 20 MB
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Discord&apos;s File Attachments FAQ says non-Nitro members can upload 20 MB, and that the
        free limit rose from 10 MB in August 2026. The same note says desktop and mobile now check
        the limit the same way: the size is measured before Discord compresses the file. A photo
        that your phone would have squeezed down after you hit send can now be rejected up front.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Discord&apos;s developer changelog records the same change as 20 MiB, which is 20 × 1024 ×
        1024 bytes, not 20,000,000. Shrinkcord uses that binary reading. An image at 19.5 MiB is
        about half a megabyte under the line the client checks.
      </p>

      <h2 className="mt-12 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
        Why some pages still say 10 MB
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Discord&apos;s account caps article still lists a 10 MB file sharing limit for the base
        plan, and 500 MB for Nitro. That table disagrees with the File Attachments FAQ and with
        the Nitro perk page, which lists 50 MB for Nitro Basic and up to 1 GB for Nitro. When
        those pages conflict, Shrinkcord follows the File Attachments FAQ, because that is the
        page Discord updated to explain the August 2026 change. Treat the older caps table as
        stale until Discord edits it.
      </p>

      <h2
        id="nitro"
        className="mt-12 scroll-mt-24 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.05] font-semibold tracking-[-0.03em]"
      >
        Nitro follows you. A boost does not.
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Nitro Basic raises your own uploads to 50 MB. Nitro raises them to 1 GB. Those limits
        travel with the account into servers and direct messages. A server boost is different: level
        2 lets everyone in that server attach 50 MB, and level 3 lets them attach 100 MB, but only
        while they are posting inside the boosted server. Leave for a DM, or for a server that is
        not boosted, and a free account is back at 20 MB.
      </p>

      <h2
        id="boosts"
        className="mt-12 scroll-mt-24 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.05] font-semibold tracking-[-0.03em]"
      >
        Images hit the cap before Discord compresses them
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        The FAQ calls out a practical consequence of checking size first. Desktop and iOS uploads
        got easier for a lot of people when the number moved from 10 MB to 20 MB. On Android, source
        photos are often larger, so the higher printed number can still reject a picture that used
        to sneak through after Discord compressed it. If the file on disk is over 20 MB, the free
        client can refuse it before any of that happens.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        That is the case Shrinkcord is for. Drop a JPEG, PNG, or WebP that is over 20 MB. The tool
        lowers quality first and only then scales the pixels, and it stops at 19.5 MB. Files that
        already fit are not touched. The work happens in the browser.
      </p>

      <div className="mt-12 flex flex-col items-start gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-sm text-muted-foreground">
          Have an image over the free limit? Shrink it here, then send the download.
        </p>
        <Button asChild>
          <Link href="/#shrink">Shrink an image</Link>
        </Button>
      </div>
    </main>
  )
}
