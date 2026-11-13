import { Suspense } from "react";
import { requireEmployee } from "@/server/current-employee";
import { BrandLogo } from "@/components/brand-logo";
import { SignOutForm } from "@/components/sign-out-form";

// Temporary home until the dashboard lands; proves the access gate end to end.
export default function Home() {
  return (
    <>
      <header className="border-b border-line bg-white/55 shadow-panel backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <BrandLogo priority className="h-9 w-auto sm:h-11" />
            <span className="h-7 w-px bg-line-strong" aria-hidden="true" />
            <span className="whitespace-nowrap font-semibold text-ink">GEDP 2027</span>
          </div>
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-14">
        <Suspense fallback={<p className="text-ink-soft">Ładowanie…</p>}>
          <Greeting />
        </Suspense>
      </main>
    </>
  );
}

async function UserMenu() {
  const employee = await requireEmployee();
  return (
    <div className="flex items-center gap-4">
      <span className="hidden text-sm text-ink sm:inline">
        {employee.firstName} {employee.lastName}
      </span>
      {employee.isHrAdmin && (
        <span className="rounded-full bg-(image:--am-gradient) px-2.5 py-0.5 text-xs font-semibold tracking-[0.06em] text-white">
          HR
        </span>
      )}
      <SignOutForm />
    </div>
  );
}

async function Greeting() {
  const employee = await requireEmployee();
  return (
    <section
      aria-labelledby="greeting"
      className="rounded-3xl border border-white/90 bg-white/75 p-8 shadow-card backdrop-blur-xl sm:p-10"
    >
      <p className="text-xs font-semibold tracking-wider text-accent uppercase">Cykl 2027</p>
      <h1 id="greeting" className="mt-3 text-3xl font-semibold text-ink sm:text-4xl">
        Witaj, {employee.firstName}
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-soft">
        Tu pojawią się Twoje cele Grupy, cele wydajnościowe i rozwojowe oraz dokumenty do zatwierdzenia.
      </p>
    </section>
  );
}
