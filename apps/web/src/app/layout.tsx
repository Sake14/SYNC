import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "SYNC — слушаем вместе",
  description: "Общая комната, ваша музыка и люди рядом. Совместное прослушивание локальных треков — Время IT 2026, ГУАП.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><Providers>{children}</Providers></body></html>;
}
