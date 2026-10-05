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

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly limit = 200;

  execute(cmd: Command): void {
    this.redoStack.length = 0; // A new command invalidates the redo branch.
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
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
