import { Compressor } from "@/components/compressor"
import { JsonLd } from "@/components/json-ld"
import { FAQ } from "@/components/ui/faq"
import { faqs } from "@/lib/faq"
import { site } from "@/lib/site"
import { Check } from "lucide-react"
import Link from "next/link"

const steps = [
  {
    title: "Drop the image",
    copy: "JPEG, PNG, or WebP. Several files run one at a time so the tab stays responsive.",
  },
  {
    title: "Small files stay as they are",
    copy: "Anything at or under 20 MB is returned unchanged. Only larger files are re-encoded.",
  },
  {
    title: "Download and send",
    copy: "The result is 19.5 MB or under, named with -discord, ready for Discord’s free upload.",
  },
]

const proofs = [
  {
    lead: "Nothing is uploaded.",
    rest: "The file is decoded and re-encoded on this device.",
  },
  {
    lead: "Quality first, then dimensions.",
    rest: "Size only shrinks if it still has to.",
  },
  {
    lead: "Files at or under 20 MB",
    rest: "are returned unchanged.",
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

      <section className="mx-auto w-full max-w-[1160px] px-[18px] pt-7 pb-10 sm:px-8 lg:pt-16 lg:pb-[72px]">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(88,101,242,0.3)] bg-[rgba(88,101,242,0.12)] px-2.5 py-1 text-[13px] font-semibold text-brand-text">
              For Discord’s free 20 MB upload limit
            </span>
            <h1 className="mt-3.5 text-[36px] leading-[1.05] font-extrabold tracking-[-0.035em] text-foreground lg:mt-5 lg:text-[54px]">
              Get any image under Discord’s{" "}
              <em className="not-italic text-brand-text">20&nbsp;MB</em> limit.
            </h1>
            <p className="lede mt-3 max-w-[30em] text-base text-muted-foreground lg:mt-[18px] lg:text-lg">
              Drop a JPEG, PNG, or WebP over 20 MB. Shrinkcord re-encodes it to{" "}
              <b className="font-semibold text-foreground">19.5 MB or less</b>, right in your
              browser. Smaller files are left untouched.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-3.5 text-[13px] text-muted-foreground lg:hidden">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-ok-text" strokeWidth={2.4} aria-hidden="true" />
                Nothing is uploaded
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-ok-text" strokeWidth={2.4} aria-hidden="true" />
                Quality first
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-ok-text" strokeWidth={2.4} aria-hidden="true" />
                Free
              </span>
            </div>
            <ul className="mt-7 hidden gap-3 lg:grid">
              {proofs.map((proof) => (
                <li key={proof.lead} className="flex items-start gap-3 text-[15px] text-foreground">
                  <Check
                    className="mt-0.5 size-[18px] shrink-0 text-ok-text"
                    strokeWidth={2.4}
                    aria-hidden="true"
                  />
                  <div>
                    {proof.lead}{" "}
                    <span className="text-muted-foreground">{proof.rest}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <Compressor />
        </div>
      </section>

      <section id="how" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto w-full max-w-[1160px] px-[18px] py-12 sm:px-8 lg:py-[72px]">
          <div className="mb-6 flex flex-col justify-between gap-2 lg:mb-8 lg:flex-row lg:items-end lg:gap-6">
            <h2 className="text-[26px] leading-[1.15] font-bold tracking-[-0.03em] lg:text-[32px]">
              How it works
            </h2>
            <p className="max-w-[28em] text-[15px] text-muted-foreground">
              Quality drops first. Dimensions shrink only if the file is still too big.
            </p>
          </div>
          <div className="grid overflow-hidden rounded-[14px] border border-border lg:grid-cols-3">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className="border-border bg-card p-5 lg:border-l lg:p-[26px] lg:pb-7 lg:first:border-l-0 [&:not(:first-child)]:border-t lg:[&:not(:first-child)]:border-t-0"
              >
                <div className="font-mono text-[13px] font-semibold text-brand-text">
                  0{index + 1}
                </div>
                <h3 className="mt-2.5 text-[17px] font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
                  {step.copy.includes("-discord") ? (
                    <>
                      The result is 19.5 MB or under, named with <code>-discord</code>, ready for
                      Discord’s free upload.
                    </>
                  ) : (
                    step.copy
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="limit" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto grid w-full max-w-[1160px] items-center gap-6 px-[18px] py-12 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:py-[72px]">
          <div>
            <h2 className="text-[34px] leading-none font-extrabold tracking-[-0.03em] lg:text-[44px]">
              Why 19.5 MB?
            </h2>
            <p className="mt-3 max-w-[30em] text-base text-muted-foreground">
              Discord counts the free cap as 20 MiB (20 × 1024 × 1024 bytes) and checks the size
              before it compresses the upload. Stopping at 19.5 MiB leaves 0.5 MiB under that
              check. Read the full{" "}
              <Link
                href="/discord-file-limit"
                className="text-foreground underline decoration-border underline-offset-4 hover:text-brand-text"
              >
                Discord file limit
              </Link>{" "}
              notes.
            </p>
          </div>
          <div className="rounded-[14px] border border-border bg-card p-5 sm:p-7">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">Your file after Shrinkcord</span>
              <span className="font-mono text-ok-text">≤ 19.5 MiB</span>
            </div>
            <div className="relative mt-8 mb-3.5 h-3.5 rounded-lg bg-accent">
              <div
                className="absolute inset-y-0 left-0 w-[88.6%] rounded-lg bg-[linear-gradient(90deg,#5865f2,#7984f5)]"
                aria-hidden="true"
              />
              <div
                className="absolute top-[-30px] bottom-[-8px] left-[90.9%] w-0.5 bg-[#ed4245]"
                aria-hidden="true"
              >
                <span className="absolute top-0 right-2 whitespace-nowrap text-xs font-semibold text-destructive">
                  Discord free cap · 20 MiB
                </span>
              </div>
            </div>
            <div className="relative h-4 font-mono text-xs text-muted-foreground">
              <span className="absolute left-0">0</span>
              <span className="absolute left-[45.5%] -translate-x-1/2">10 MiB</span>
              <span className="absolute left-[90.9%] -translate-x-1/2 whitespace-nowrap">
                20 MiB
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 border-t border-border">
        <div className="mx-auto w-full max-w-[1160px] px-[18px] py-12 sm:px-8 lg:py-[72px]">
          <h2 className="text-[26px] leading-[1.15] font-bold tracking-[-0.03em] lg:text-[32px]">
            Before you send it
          </h2>
          <div className="mt-6 lg:mt-8">
            <FAQ
              items={[...faqs]}
              iconStyle="plus-minus"
              allowMultiple
              variant="separated"
              defaultOpen={faqs[0].id}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
