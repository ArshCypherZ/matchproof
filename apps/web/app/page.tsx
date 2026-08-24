import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-12">
      <h1 className="text-3xl font-semibold">Payment Incident Commander</h1>
      <p className="mt-4">Evidence-driven payment operations controller.</p>
      <Button className="mt-6" disabled>
        Workflow controls arrive in a later ticket
      </Button>
    </main>
  );
}
