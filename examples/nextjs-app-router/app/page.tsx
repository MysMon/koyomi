import { CalendarClient } from './calendar-client';

/**
 * トップページ（サーバーコンポーネント）。
 * カレンダー本体はブラウザ API に依存するため、`'use client'` 境界を持つ
 * `CalendarClient` に切り出して描画している。
 */
export default function Page() {
  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Koyomi + Next.js App Router</h1>
      <p>予定のドラッグ移動・リサイズ・空き領域のドラッグでの新規作成を試せます。</p>
      <CalendarClient />
    </main>
  );
}
