import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { BrandMark } from "@/components/brand/BrandMark";

export const metadata: Metadata = {
  title: "Вход — АвтоЦена",
  robots: { index: false, follow: false }
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const nextPath = firstParam(params.next) || "/crm";

  return (
    <main className="min-h-screen px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10 shrink-0 md:h-11 md:w-11" />
            <div>
              <div className="text-[18px] font-black leading-none md:text-[22px]"><span className="text-red-500">Авто</span><span className="text-white">Цена</span></div>
              <div className="text-[12px] font-bold leading-none text-white/45">avtocena.com</div>
            </div>
          </Link>
          <Link href="/" className="rounded-full bg-white/8 px-4 py-2 text-sm font-bold text-white/70">На главную</Link>
        </header>

        <section className="grid min-h-[72vh] place-items-center py-10">
          <LoginForm nextPath={nextPath} />
        </section>
      </div>
    </main>
  );
}
