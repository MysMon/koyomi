/**
 * @packageDocumentation
 * `event.color` / `resource.color` と前景色の WCAG コントラスト比の判定。
 *
 * `useCalendar` の開発ビルド限定警告（`docs/accessibility.md` 参照）でのみ使用する。
 * 16 進カラーコード（`#rgb` / `#rrggbb`）のみを解釈する。`rgb()` / `hsl()` / 色名
 * 等の他の CSS 色表記まではパースしない（判定できない場合は警告しない、安全側の
 * 既知の制限）。
 *
 * 非公開モジュール（`index.ts` から re-export しない）。
 */

/** WCAG AA（通常文字）が要求する最低コントラスト比。 */
const WCAG_AA_CONTRAST_RATIO = 4.5;

/**
 * 既定テーマの明るいテーマにおける前景色（`--koyomi-event-fg` の既定値、白）。
 * `event.color` は任意の CSS 色を受け付けダークテーマでは前景色が変わるため、
 * この判定はあくまで既定の明るいテーマを基準にした目安である。
 */
const DEFAULT_EVENT_FOREGROUND = '#ffffff';

/** sRGB の 1 チャンネル（0〜255）をガンマ補正した線形値（WCAG 相対輝度の式）に変換する。 */
function linearizeChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** パース済みの RGB（各 0〜255）。 */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` / `#rrggbb` 形式の 16 進カラーコードを RGB に変換する。パースできなければ `null`。 */
function parseHexColor(color: string): Rgb | null {
  const trimmed = color.trim();
  const shortMatch = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(trimmed);
  if (shortMatch !== null) {
    const [, r, g, b] = shortMatch;
    // 正規表現がマッチした時点でキャプチャグループ 1〜3 は必ず存在するが、
    // 型上は string | undefined のため、ここで narrow する
    if (r === undefined || g === undefined || b === undefined) {
      return null;
    }
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }
  const longMatch = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(trimmed);
  if (longMatch !== null) {
    const [, r, g, b] = longMatch;
    if (r === undefined || g === undefined || b === undefined) {
      return null;
    }
    return {
      r: Number.parseInt(r, 16),
      g: Number.parseInt(g, 16),
      b: Number.parseInt(b, 16),
    };
  }
  return null;
}

/** WCAG の相対輝度（0〜1）を求める。 */
function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearizeChannel(rgb.r) +
    0.7152 * linearizeChannel(rgb.g) +
    0.0722 * linearizeChannel(rgb.b)
  );
}

/**
 * 2 色間の WCAG コントラスト比（1〜21）を求める。
 * どちらか一方が 16 進カラーコード（`#rgb` / `#rrggbb`）としてパースできない場合は
 * `null`。
 *
 * @param colorA - 比較する色（16 進カラーコード）
 * @param colorB - 比較する色（16 進カラーコード）
 * @returns コントラスト比。パースできない色を含む場合は `null`
 */
export function contrastRatio(colorA: string, colorB: string): number | null {
  const a = parseHexColor(colorA);
  const b = parseHexColor(colorB);
  if (a === null || b === null) {
    return null;
  }
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 判定対象の色の出所。警告文言に反映し、利用者がどのフィールドの色を
 * 直せばよいかを特定できるようにする。
 */
export type LowContrastColorSource = 'event' | 'resource';

/** 色の出所ごとの警告文言上の呼称。 */
const COLOR_SOURCE_LABELS: Record<LowContrastColorSource, string> = {
  event: 'イベント色（event.color）',
  resource: 'リソース色（resource.color）',
};

/**
 * `event.color` / `resource.color` が既定の前景色との組み合わせで
 * WCAG AA（4.5:1）を満たさない場合、`console.warn` で警告する。
 * 警告文言には色の出所（`source`）に応じて「イベント色」/「リソース色」を表示する。
 *
 * 同じ色を繰り返し警告しないよう、警告済みの色を呼び出し側が持つ `warned` に
 * 積む（呼び出し側は通常、コンポーネントのマウント中保持する `Set` を渡す。
 * 出所が異なっても同じ色は再警告しない）。
 * 16 進カラーコード以外（色名・`rgb()` 等）は判定できないため警告しない。
 *
 * @param color - 判定対象の色（`event.color` / `resource.color` の値）
 * @param source - 色の出所（`'event'` = `event.color`、`'resource'` = `resource.color`）
 * @param warned - 警告済みの色を積む `Set`（呼び出し側が保持する）
 */
export function warnIfLowContrastEventColor(
  color: string,
  source: LowContrastColorSource,
  warned: Set<string>,
): void {
  if (warned.has(color)) {
    return;
  }
  const ratio = contrastRatio(color, DEFAULT_EVENT_FOREGROUND);
  if (ratio === null || ratio >= WCAG_AA_CONTRAST_RATIO) {
    return;
  }
  warned.add(color);
  // biome-ignore lint/suspicious/noConsole: 開発ビルド限定の意図的な利用者向け警告
  console.warn(
    `[koyomi] ${COLOR_SOURCE_LABELS[source]} ${color} は既定の前景色（白 ${DEFAULT_EVENT_FOREGROUND}）との組み合わせで` +
      `WCAG AA のコントラスト比 4.5:1 を満たしません（実際の比率: ${ratio.toFixed(2)}:1）。` +
      'カスタムテーマで --koyomi-event-fg を変更している場合は、その配色でコントラストを確認してください。',
  );
}
