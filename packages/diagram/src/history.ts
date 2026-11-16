/**
 * Undo/redo over an immutable Play (docs/diagrams.md §Editing model). Each command is a pure
 * function Play → Play; the stack stores the Play before and after, so undo/redo are O(1) and
 * structural sharing keeps memory small. A drag is one command: `begin()`, any number of
 * `apply()`s, then `commit()`.
 */
import type { Play } from '@phaseplay/shared';

export type Command = { label: string; run: (play: Play) => Play };
type Entry = { label: string; before: Play; after: Play };

export type HistoryOptions = { cap?: number; onChange?: (play: Play) => void };

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private current: Play;
  private pending: { label: string; before: Play } | null = null;
  private readonly cap: number;
  private readonly onChange?: (play: Play) => void;

  constructor(initial: Play, opts: HistoryOptions = {}) {
    this.current = initial;
    this.cap = Math.max(1, opts.cap ?? 200);
    this.onChange = opts.onChange;
  }

  /** The current Play. */
  get present(): Play {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0 || (this.pending !== null && this.pending.before !== this.current);
  }
  get canRedo(): boolean {
    return this.future.length > 0 && this.pending === null;
  }
  /** Label of the command undo would revert, for "Undo move" style UI. */
  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  /**
   * Apply a command (or a plain Play → Play function). Inside begin()/commit() the change is
   * coalesced into the pending command. No-op commands (returning the same Play) are ignored.
   */
  apply(cmd: Command | ((play: Play) => Play), label = 'Edit'): Play {
    const run = typeof cmd === 'function' ? cmd : cmd.run;
    const name = typeof cmd === 'function' ? label : cmd.label;
    const next = run(this.current);
    if (next === this.current) return next;
    if (this.pending) {
      this.current = next;
    } else {
      this.push({ label: name, before: this.current, after: next });
      this.current = next;
    }
    this.onChange?.(next);
    return next;
  }

  /** Start coalescing (e.g. on pointerdown of a drag). Nested begins are ignored. */
  begin(label = 'Edit'): void {
    if (!this.pending) this.pending = { label, before: this.current };
  }

  /** Finish coalescing: everything since begin() becomes one undoable command. */
  commit(): void {
    const p = this.pending;
    this.pending = null;
    if (p && p.before !== this.current)
      this.push({ label: p.label, before: p.before, after: this.current });
  }

  /** Abandon the pending gesture and restore the Play from before begin(). */
  cancel(): void {
    const p = this.pending;
    this.pending = null;
    if (p && p.before !== this.current) {
      this.current = p.before;
      this.onChange?.(this.current);
    }
  }

  undo(): Play {
    if (this.pending) this.commit();
    const e = this.past.pop();
    if (!e) return this.current;
    this.future.push(e);
    this.current = e.before;
    this.onChange?.(this.current);
    return this.current;
  }

  redo(): Play {
    if (this.pending) return this.current;
    const e = this.future.pop();
    if (!e) return this.current;
    this.past.push(e);
    this.current = e.after;
    this.onChange?.(this.current);
    return this.current;
  }

  /** Replace the present without an undo entry (e.g. "Take theirs" after a sync conflict). */
  reset(play: Play): void {
    this.past = [];
    this.future = [];
    this.pending = null;
    this.current = play;
    this.onChange?.(play);
  }

  get size(): number {
    return this.past.length;
  }

  private push(e: Entry): void {
    this.past.push(e);
    if (this.past.length > this.cap) this.past.splice(0, this.past.length - this.cap);
    this.future = [];
  }
}
