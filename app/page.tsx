import { Compressor } from "@/components/compressor"
import { JsonLd } from "@/components/json-ld"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FAQ } from "@/components/ui/faq"
import { SpotlightCard } from "@/components/ui/spotlight-card"
import { faqs } from "@/lib/faq"
import { site } from "@/lib/site"
import { Lock, ScanSearch, UnfoldHorizontal } from "lucide-react"
import Link from "next/link"

const steps = [
  {
    title: "Drop the image",
    copy: "JPEG, PNG, or WebP. Several files run one at a time so the tab stays responsive.",
  },
  {
    title: "Leave small files alone",
    copy: "Anything at or under 20 MB is returned unchanged. Only larger files are re-encoded.",
  },
  {
    title: "Download and send",
    copy: "The result is 19.5 MB or under, named with -discord, ready for a free Discord upload.",
  },
]

const capabilities = [
  {
    icon: Lock,
    title: "Stays in the browser",
    copy: "The image is decoded on this device. Shrinkcord never receives the file.",
  },
  {
    icon: ScanSearch,
    title: "Only files over 20 MB",
    copy: "The free Discord cap is the line. Smaller images are not recompressed.",
  },
  {
    icon: UnfoldHorizontal,
    title: "19.5 MB cushion",
    copy: "Quality drops first. Dimensions shrink only if the file is still too big.",
  },
]

export default function Home() {
  return (
    <main>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Shrinkcord",
          applicationCategory: "MultimediaApplication",
          operatingSystem: "Web",
          url: site.url,
          description: site.description,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
          browserRequirements: "Requires a browser that can encode JPEG or WebP on a canvas.",
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.answer,
            },
          })),
        }}
      />

      <section className="mx-auto w-full max-w-[1280px] px-4 pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="mx-auto max-w-[980px] text-center">
          <p className="font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-primary uppercase">
            Discord limit
          </p>
          <h1 className="mx-auto mt-4 max-w-[12em] text-[clamp(2.75rem,7vw,6.75rem)] leading-[0.92] font-semibold tracking-[-0.055em] text-foreground">
            Shrink images Discord will take.
          </h1>
          <p className="mx-auto mt-6 max-w-[650px] text-base leading-relaxed text-muted-foreground">
            Free Discord accounts stop at 20 MB. Shrinkcord brings larger JPEG, PNG, and WebP files
            down to 19.5 MB in your browser, and leaves smaller ones untouched.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="#shrink">Shrink an image</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/discord-file-limit">Discord file limit</Link>
            </Button>
          </div>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            Runs locally. Nothing is uploaded.
          </p>
        </div>
        <div className="mx-auto mt-12 max-w-[880px]">
          <Compressor />
        </div>
      </section>

      <section id="how" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-16 md:py-24">
          <p className="font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            How it works
          </p>
          <h2 className="mt-3 max-w-xl text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Quality first, then dimensions
          </h2>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => (
              <Card key={step.title}>
                <CardHeader>
                  <p className="font-mono text-xs text-primary">0{index + 1}</p>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.copy}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid w-full max-w-[1280px] gap-3 px-4 py-16 md:grid-cols-3 md:py-24">
          {capabilities.map((item) => (
            <SpotlightCard key={item.title}>
              <item.icon className="size-4 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold tracking-[-0.01em]">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.copy}</p>
            </SpotlightCard>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-[800px] px-4 py-16 text-center md:py-24">
          <p className="font-mono text-[clamp(1.75rem,4vw,3rem)] leading-none text-foreground">
            <span className="text-primary">19.5 MB</span>, so the file clears 20.
          </p>
          <p className="mx-auto mt-4 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            Discord measures the free cap as 20 MiB and checks that size before it compresses the
            upload. Half a megabyte of room is the insurance.
          </p>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-16 md:py-24">
          <p className="text-center font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            FAQ
          </p>
          <h2 className="mt-3 text-center text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Before you send it
          </h2>
          <div className="mt-8">
            <FAQ items={[...faqs]} iconStyle="plus-minus" />
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start justify-between gap-6 px-4 py-16 md:flex-row md:items-center md:py-20">
          <div>
            <h2 className="text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              Get the image under the line.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Drop a file over 20 MB. Download one that Discord&apos;s free upload will accept.
            </p>
          </div>
          <Button asChild>
            <Link href="#shrink">Shrink an image</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
