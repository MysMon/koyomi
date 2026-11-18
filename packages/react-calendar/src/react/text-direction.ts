/**
 * @packageDocumentation
 * 書字方向（LTR / RTL）に依存する処理の共通ヘルパ。
 *
 * ビルトインコンポーネントは水平方向の位置を論理プロパティ（`insetInlineStart` 等）と
 * グリッド・フレックスで出力するため、`dir="rtl"` の文書では日・列・時間軸の並びが
 * 左右反転する。ポインタ座標や ←/→ キーのように**物理方向**で届く入力を、並びの
 * 方向（行頭 → 行末）に対応づける処理をここに集約する。
 */

/**
 * 要素の書字方向が RTL かどうかを判定する（算出スタイルの `direction`）。
 *
 * @param element - 判定する要素（祖先の `dir` 属性・`direction` 指定は継承されて反映される）
 * @returns RTL なら `true`
 */
export function isRtl(element: Element): boolean {
  return getComputedStyle(element).direction === 'rtl';
}

/**
 * 矩形内でのポインタの横位置を、行頭（inline-start）の端からの割合として求める。
 *
 * LTR では左端から、RTL では右端からの距離の割合になる。`insetInlineStart` で配置される
 * 要素の位置（行頭からの割合）と同じ基準なので、ポインタ位置をそのまま時間軸上の位置に
 * 対応づけられる。
 *
 * @param rect - 対象要素の矩形（`left` と `width` を使う）
 * @param clientX - ポインタの clientX
 * @param rtl - 対象要素の書字方向が RTL か（{@link isRtl}）
 * @returns 行頭の端を 0、行末の端を 1 とする割合（矩形の外では範囲外の値）。幅が 0 以下なら 0
 */
export function inlineStartFraction(
  rect: { left: number; width: number },
  clientX: number,
  rtl: boolean,
): number {
  if (rect.width <= 0) {
    return 0;
  }
  const fromLeft = (clientX - rect.left) / rect.width;
  return rtl ? 1 - fromLeft : fromLeft;
}

/**
 * ←/→ キーを、要素の書字方向に合わせて「並びの方向」のキーへ読み替える。
 *
 * 戻り値の `'ArrowLeft'` は並びの前方（行頭側）、`'ArrowRight'` は後方（行末側）を表す。
 * LTR ではそのまま、RTL では ←/→ を入れ替えて返すため、呼び出し側は LTR 前提の
 * 「← = 前、→ = 次」の処理のまま、RTL でも「矢印キーは画面上でその方向に動く」を保てる。
 * ←/→ 以外のキーはそのまま返す（書字方向も調べない）。
 *
 * @param key - `KeyboardEvent.key`
 * @param element - 書字方向を判定する要素（キー操作を受けた要素）
 * @returns 並びの方向に読み替えたキー
 */
export function readingOrderArrowKey(key: string, element: Element): string {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
    return key;
  }
  if (!isRtl(element)) {
    return key;
  }
  return key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
}
