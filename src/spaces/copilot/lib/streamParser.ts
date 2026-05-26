// src/spaces/copilot/lib/streamParser.ts
import type { CopilotStreamEvent } from '../types/copilot.types';

/**
 * Parseur SSE incrémental.
 * On lui pousse des chunks de texte (push), il émet des events complets.
 * flush() traite un éventuel reliquat en fin de stream.
 */
export class SSEParser {
  private buffer = '';

  constructor(private readonly onEvent: (event: CopilotStreamEvent) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // La dernière ligne peut être partielle → on la garde pour le prochain chunk
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.handleLine(line);
  }

  flush(): void {
    if (this.buffer.trim()) this.handleLine(this.buffer);
    this.buffer = '';
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const event = JSON.parse(payload) as CopilotStreamEvent;
      this.onEvent(event);
    } catch {
      // Ligne JSON incomplète/illisible → on ignore silencieusement
    }
  }
}