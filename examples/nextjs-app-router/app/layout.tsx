import '@koyomi-cal/react/theme.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Koyomi Next.js App Router 例',
  description: 'Koyomi（@koyomi-cal/react）を Next.js App Router で使う最小構成の例。',
};

/**
 * ルートレイアウト。
 * `@koyomi-cal/react/theme.css` はグローバルスタイルシートなので、
 * App Router の制約に従いルートレイアウトでのみ import している。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
