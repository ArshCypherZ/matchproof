import type { Metadata } from "next";
import { SourceBadge } from "@/components/shared/source-badge";
import { DemoStepper } from "@/components/demo/demo-stepper";

export const metadata: Metadata = { title: "Test payment walkthrough" };

export default function DemoPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="border-b border-border pb-8">
        <div className="mb-3">
          <SourceBadge source="razorpay_test" />
        </div>
        <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          Test payment walkthrough
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Create a real Razorpay Test-mode order, pay it with the test card, and
          watch the controller match it to the merchant order, request approval,
          and confirm both records agree.
        </p>
      </div>
      <section className="mt-8 grid overflow-hidden border border-ticket-ink/20 bg-ticket text-ticket-ink md:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)]">
        <div className="p-6 sm:p-8">
          <div>
            <p className="font-data text-2xs uppercase tracking-[0.12em]">
              Test payment recovery
            </p>
            <h2 className="mt-4 max-w-[18ch] font-serif text-4xl font-normal leading-[1.08] sm:text-5xl">
              Confirm the captured payment, update the merchant order, and
              verify both records agree.
            </h2>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="border-t border-ticket-ink/20 bg-ticket-ink p-5 text-ticket-paper md:border-t-0 md:border-l sm:p-7"
        >
          <div className="flex items-center justify-between font-data text-2xs uppercase tracking-[0.1em] text-ticket-paper/80">
            <span>Recovery flow</span>
            <span className="bg-ticket-paper px-2 py-1 text-ticket-ink">
              Test mode
            </span>
          </div>
          <div className="mt-8 grid grid-cols-4 gap-2">
            {["Observe", "Gather", "Diagnose", "Verify"].map((step, index) => (
              <div key={step}>
                <span
                  className={`block h-1 ${index < 3 ? "bg-ticket" : "bg-ticket-paper/20"}`}
                />
                <p className="mt-2 font-data text-2xs uppercase tracking-[0.08em] text-ticket-paper/80">
                  {step}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-8 border border-ticket-paper/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-data text-2xs uppercase tracking-[0.1em] text-ticket-paper/70">
                  Provider evidence
                </p>
                <p className="mt-2 text-sm">Payment captured</p>
              </div>
              <span className="bg-ticket px-2 py-1 font-data text-2xs uppercase tracking-[0.08em] text-ticket-ink">
                verified
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 border border-ticket-paper/20 p-4">
            <p className="font-data text-2xs uppercase tracking-[0.1em] text-ticket-paper/70">
              Approval decision
            </p>
            <span className="bg-ticket-paper px-2 py-1 font-data text-2xs uppercase tracking-[0.08em] text-ticket-ink">
              approval required
            </span>
          </div>
        </div>
      </section>
      <DemoStepper />
    </main>
  );
}
