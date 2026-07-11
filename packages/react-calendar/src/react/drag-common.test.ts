/**
 * drag-common.ts の {@link eventNotificationProps} のテスト。
 *
 * ドラッグ操作を経由しない純粋なプロップゲッターのため、DOM 描画を介さず
 * 直接呼び出して検証する（DOM 経由の統合テストは各ビューのフック・
 * コンポーネントのテストファイル側で行う）。
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, EventOccurrence } from '../core/types';
import { eventNotificationProps } from './drag-common';
import type { CalendarInteractionCallbacks } from './types';

/** テスト用の最小限のオカレンス。 */
function makeOccurrence(): EventOccurrence {
  const event: CalendarEvent = { id: 'e1', title: '会議', start: '2026-07-15T10:00' };
  return {
    key: 'e1::2026-07-15T01:00:00.000Z',
    eventId: 'e1',
    event,
    start: new Date('2026-07-15T01:00:00Z'),
    end: new Date('2026-07-15T02:00:00Z'),
    originalStart: new Date('2026-07-15T01:00:00Z'),
    allDay: false,
    isRecurring: false,
  };
}

/**
 * テスト用の最小限の `ReactMouseEvent`（`nativeEvent` のみ参照される）。
 * 本物の SyntheticEvent は React が生成するため、テストでは `nativeEvent` だけを
 * 持つ最小限の値を用意し、実装が読む唯一のプロパティであることを型で保証する
 * 手段がないためここでのみ `as` キャストを使う。
 */
function makeMouseEvent(nativeEvent: MouseEvent): ReactMouseEvent<HTMLElement> {
  return { nativeEvent } as ReactMouseEvent<HTMLElement>;
}

/** {@link makeMouseEvent} の `ReactPointerEvent` 版。 */
function makePointerEvent(nativeEvent: MouseEvent): ReactPointerEvent<HTMLElement> {
  return { nativeEvent } as ReactPointerEvent<HTMLElement>;
}

describe('eventNotificationProps', () => {
  it('コールバックが 1 つも指定されていない場合、キーを 1 つも含まないオブジェクトを返す', () => {
    const occurrence = makeOccurrence();
    const props = eventNotificationProps(undefined, occurrence);
    expect(Object.keys(props)).toEqual([]);
  });

  it('onEventDoubleClick のみ指定時、onDoubleClick だけを含み、オカレンスと nativeEvent を渡す', () => {
    const occurrence = makeOccurrence();
    const onEventDoubleClick = vi.fn();
    const callbacks: CalendarInteractionCallbacks = { onEventDoubleClick };
    const props = eventNotificationProps(callbacks, occurrence);

    expect(Object.keys(props)).toEqual(['onDoubleClick']);
    const nativeEvent = new MouseEvent('dblclick');
    props.onDoubleClick?.(makeMouseEvent(nativeEvent));
    expect(onEventDoubleClick).toHaveBeenCalledTimes(1);
    expect(onEventDoubleClick).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('onEventContextMenu のみ指定時、onContextMenu だけを含み、preventDefault は呼ばれない', () => {
    const occurrence = makeOccurrence();
    const onEventContextMenu = vi.fn();
    const props = eventNotificationProps({ onEventContextMenu }, occurrence);

    expect(Object.keys(props)).toEqual(['onContextMenu']);
    const nativeEvent = new MouseEvent('contextmenu', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(nativeEvent, 'preventDefault');
    props.onContextMenu?.(makeMouseEvent(nativeEvent));

    expect(onEventContextMenu).toHaveBeenCalledTimes(1);
    expect(onEventContextMenu).toHaveBeenCalledWith(occurrence, nativeEvent);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('onEventHover のみ指定時、onPointerEnter だけを含む', () => {
    const occurrence = makeOccurrence();
    const onEventHover = vi.fn();
    const props = eventNotificationProps({ onEventHover }, occurrence);

    expect(Object.keys(props)).toEqual(['onPointerEnter']);
    const nativeEvent = new MouseEvent('pointerover');
    props.onPointerEnter?.(makePointerEvent(nativeEvent));
    expect(onEventHover).toHaveBeenCalledTimes(1);
    expect(onEventHover).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('onEventHoverEnd のみ指定時、onPointerLeave だけを含む', () => {
    const occurrence = makeOccurrence();
    const onEventHoverEnd = vi.fn();
    const props = eventNotificationProps({ onEventHoverEnd }, occurrence);

    expect(Object.keys(props)).toEqual(['onPointerLeave']);
    const nativeEvent = new MouseEvent('pointerout');
    props.onPointerLeave?.(makePointerEvent(nativeEvent));
    expect(onEventHoverEnd).toHaveBeenCalledTimes(1);
    expect(onEventHoverEnd).toHaveBeenCalledWith(occurrence, nativeEvent);
  });

  it('4 つとも指定時、4 つのキーすべてを含む', () => {
    const occurrence = makeOccurrence();
    const callbacks: CalendarInteractionCallbacks = {
      onEventDoubleClick: vi.fn(),
      onEventContextMenu: vi.fn(),
      onEventHover: vi.fn(),
      onEventHoverEnd: vi.fn(),
    };
    const props = eventNotificationProps(callbacks, occurrence);
    expect(Object.keys(props).sort()).toEqual(
      ['onContextMenu', 'onDoubleClick', 'onPointerEnter', 'onPointerLeave'].sort(),
    );
  });
});
