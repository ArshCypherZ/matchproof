import type { Metadata } from "next";
import { DemoStepper } from "@/components/demo/demo-stepper";

export const metadata: Metadata = { title: "Test payment walkthrough" };

export default function DemoPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-rail py-10 sm:py-14">
      {/* The walkthrough is one column: the header rule ends where the steps
         end. Sibling pages run the rule across the rail because their content
         fills it; here it would promise content that never arrives. */}
      <div className="max-w-2xl">
        <div className="border-b border-border pb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Test payment walkthrough
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Create a real Test-mode order, pay with the test card, and watch the
            controller reconcile the payment and the merchant order.
          </p>
        </div>
        <DemoStepper />
      </div>
    </main>
  );
}
