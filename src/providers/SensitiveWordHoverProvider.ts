/**
 * Monaco Editor Hover Provider for Sensitive Words
 * 
 * Provides hover tooltips for sensitive words detected in the editor.
 * Uses Monaco's Hover Provider API for better integration.
 * 
 * Requirements: 11.3
 */

import type * as monaco from 'monaco-editor';
import type { SensitiveWordMatch } from '../services/SensitiveWordService';

export interface SensitiveWordHoverProviderOptions {
  /**
   * Get current sensitive word matches for the document
   */
  getMatches: () => SensitiveWordMatch[];
}

/**
 * Create a hover provider for sensitive words
 * 
 * @param options - Configuration options
 * @returns Monaco hover provider
 */
export function createSensitiveWordHoverProvider(
  options: SensitiveWordHoverProviderOptions
): monaco.languages.HoverProvider {
  const { getMatches } = options;

  return {
    provideHover(model, position) {
      const matches = getMatches();
      if (!matches || matches.length === 0) {
        return null;
      }

      // Get the offset at the current position
      const offset = model.getOffsetAt(position);

      // Find if the cursor is over a sensitive word
      const match = matches.find(
        (m) => offset >= m.startIndex && offset < m.endIndex
      );

      if (!match) {
        return null;
      }

      // Convert match indices to Monaco range
      const startPos = model.getPositionAt(match.startIndex);
      const endPos = model.getPositionAt(match.endIndex);

      // Get monaco namespace
      const Range = (window as any).monaco?.Range;
      if (!Range) {
        console.error('Monaco Range not available');
        return null;
      }

      const range = new Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column
      );

      // Create hover content
      const severityText = getSeverityText(match.severity);
      const severityEmoji = getSeverityEmoji(match.severity);
      
      const contents = [
        {
          value: `**${severityEmoji} 敏感词检测**`,
        },
        {
          value: `词语: \`${match.word}\``,
        },
        {
          value: `严重程度: ${severityText}`,
        },
        {
          value: '---',
        },
        {
          value: '💡 建议: 请检查此内容是否符合发布平台的要求',
        },
      ];

      return {
        range,
        contents,
      };
    },
  };
}

/**
 * Get severity text in Chinese
 */
function getSeverityText(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'low':
      return '低 (Low)';
    case 'medium':
      return '中 (Medium)';
    case 'high':
      return '高 (High)';
  }
}

/**
 * Get severity emoji
 */
function getSeverityEmoji(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'low':
      return '⚠️';
    case 'medium':
      return '⚠️';
    case 'high':
      return '🚫';
  }
}
