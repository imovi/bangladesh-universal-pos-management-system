export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Universal POS Admin
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          বাংলাদেশ সার্বজনীন পিওএস ব্যাক অফিস ম্যানেজমেন্ট ড্যাশবোর্ড
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Phase 1B Ready
          </span>
        </div>
      </div>
    </main>
  );
}
