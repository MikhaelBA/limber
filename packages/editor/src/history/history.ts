/**
 * Command Pattern & history (DESIGN.md §5.3).
 *
 * Module-level (NOT Zustand state — mutating store fields outside set() is an
 * anti-pattern). The store only mirrors canUndo/canRedo for the UI.
 */

export interface Command {
  /** Future "Edit > Undo <label>" menu text. */
  readonly label: string;
  do(): void;
  undo(): void;
}

/**
 * Sequences several commands as ONE history entry (e.g. dropping an image =
 * import texture + add slot + add attachment). Undo runs parts in reverse.
 */
export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private readonly parts: Command[],
  ) {}

  do(): void {
    const completed: Command[] = [];
    try {
      for (const part of this.parts) {
        part.do();
        completed.push(part);
      }
    } catch (error) {
      const failures: unknown[] = [error];
      for (let i = completed.length - 1; i >= 0; i--) {
        try {
          completed[i]!.undo();
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      if (failures.length > 1) throw new AggregateError(failures, 'Composite command and rollback failed.');
      throw error;
    }
  }

  undo(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i]!.undo();
  }
}

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly limit = 200;

  execute(cmd: Command): void {
    cmd.do();
    this.redoStack.length = 0; // Only a successful command invalidates redo.
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  undo(): boolean {
    const cmd = this.undoStack.at(-1);
    if (!cmd) return false;
    cmd.undo();
    this.undoStack.pop();
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.at(-1);
    if (!cmd) return false;
    cmd.do();
    this.redoStack.pop();
    this.undoStack.push(cmd);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export const history = new HistoryManager();
