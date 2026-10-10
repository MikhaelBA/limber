import type { NativeFiredEvent } from './NativeRigPlayer';

export interface OwnedEvent {
  event: NativeFiredEvent;
  current(): boolean;
  deliver(current: () => boolean): void;
}
export interface OwnerHooks {
  claim(events: (event: OwnedEvent) => void): void;
  advance(forceStep: boolean): number;
  clearEvents(): void;
  beginFrame(): void;
  finishFrame(): void;
}
const players = new WeakMap<object, OwnerHooks>();
/** Private orchestration hooks; SDK users drive owned children through their artboard. */
export function registerNativeOwner(player: object, hooks: OwnerHooks): void {
  players.set(player, hooks);
}
export function nativeOwner(player: object): OwnerHooks {
  const hooks = players.get(player);
  if (!hooks) throw new Error('Native player does not support artboard ownership.');
  return hooks;
}
