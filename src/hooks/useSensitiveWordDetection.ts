/**
 * Hook for sensitive word detection in Monaco Editor
 * 
 * Integrates SensitiveWordService with Monaco Editor using Web Worker for background detection.
 * Provides real-time marking of sensitive words with wavy underlines.
 * 
 * Requirements: 11.1, 11.2, 15.4
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type * as monaco from 'monaco-editor';
import type { SensitiveWordMatch } from '../services/SensitiveWordService';
import { createSensitiveWordHoverProvider } from '../providers/SensitiveWordHoverProvider';

// Worker message types
interface DetectMessage {
  type: 'detect';
  text: string;
  requestId: string;
}

interface LoadDictionaryMessage {
  type: 'loadDictionary';
  words: string[];
}

// Worker response types
interface DetectResponse {
  type: 'detectResult';
  matches: SensitiveWordMatch[];
  requestId: string;
}

interface ErrorResponse {
  type: 'error';
  error: string;
  requestId?: string;
}

type WorkerResponse = DetectResponse | ErrorResponse;

export interface UseSensitiveWordDetectionOptions {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  enabled: boolean;
  dictionary?: string[];
  debounceMs?: number;
}

export interface UseSensitiveWordDetectionResult {
  sensitiveWordCount: number;
  isDetecting: boolean;
  loadDictionary: (words: string[]) => void;
}

/**
 * Hook to enable sensitive word detection in Monaco Editor
 * 
 * @param options - Configuration options
 * @returns Detection state and control functions
 */
export function useSensitiveWordDetection(
  options: UseSensitiveWordDetectionOptions
): UseSensitiveWordDetectionResult {
  const { editor, enabled, dictionary = [], debounceMs = 500 } = options;

  const [sensitiveWordCount, setSensitiveWordCount] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const debounceTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestRef = useRef<string | null>(null);
  const matchesRef = useRef<SensitiveWordMatch[]>([]);
  const hoverProviderRef = useRef<monaco.IDisposable | null>(null);

  /**
   * Initialize Web Worker
   */
  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL('../workers/sensitiveWord.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Handle worker messages
    workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.type === 'detectResult') {
        // Only process if this is the latest request
        if (response.requestId === pendingRequestRef.current) {
          matchesRef.current = response.matches;
          applyDecorations(response.matches);
          setSensitiveWordCount(response.matches.length);
          setIsDetecting(false);
          pendingRequestRef.current = null;
        }
      } else if (response.type === 'error') {
        console.error('Sensitive word detection error:', response.error);
        setIsDetecting(false);
        if (response.requestId === pendingRequestRef.current) {
          pendingRequestRef.current = null;
        }
      }
    };

    // Handle worker errors
    workerRef.current.onerror = (error) => {
      console.error('Sensitive word worker error:', error);
      setIsDetecting(false);
      pendingRequestRef.current = null;
    };

    // Cleanup on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  /**
   * Load dictionary into worker
   */
  const loadDictionary = useCallback((words: string[]) => {
    if (workerRef.current) {
      const message: LoadDictionaryMessage = {
        type: 'loadDictionary',
        words,
      };
      workerRef.current.postMessage(message);
    }
  }, []);

  /**
   * Load initial dictionary
   */
  useEffect(() => {
    if (dictionary.length > 0) {
      loadDictionary(dictionary);
    }
  }, [dictionary, loadDictionary]);

  /**
   * Apply decorations to editor
   */
  const applyDecorations = useCallback(
    (matches: SensitiveWordMatch[]) => {
      if (!editor) return;

      const model = editor.getModel();
      if (!model) return;

      // Get monaco namespace from editor
      const Range = (editor as any).constructor.Range || (window as any).monaco?.Range;
      if (!Range) {
        console.error('Monaco Range not available');
        return;
      }

      // Convert matches to Monaco decorations
      const newDecorations: monaco.editor.IModelDeltaDecoration[] = matches.map((match) => {
        const startPos = model.getPositionAt(match.startIndex);
        const endPos = model.getPositionAt(match.endIndex);

        // Determine decoration class based on severity
        let inlineClassName = 'sensitive-word-decoration';
        if (match.severity === 'high') {
          inlineClassName = 'sensitive-word-decoration-high';
        } else if (match.severity === 'medium') {
          inlineClassName = 'sensitive-word-decoration-medium';
        } else {
          inlineClassName = 'sensitive-word-decoration-low';
        }

        return {
          range: new Range(
            startPos.lineNumber,
            startPos.column,
            endPos.lineNumber,
            endPos.column
          ),
          options: {
            inlineClassName,
            stickiness: 1, // TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          },
        };
      });

      // Apply decorations
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    },
    [editor]
  );

  /**
   * Clear all decorations
   */
  const clearDecorations = useCallback(() => {
    if (!editor) return;

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    setSensitiveWordCount(0);
    matchesRef.current = [];
  }, [editor]);

  /**
   * Detect sensitive words in current editor content
   */
  const detectSensitiveWords = useCallback(() => {
    if (!editor || !workerRef.current || !enabled) {
      clearDecorations();
      return;
    }

    const model = editor.getModel();
    if (!model) {
      clearDecorations();
      return;
    }

    const text = model.getValue();

    // Generate unique request ID
    const requestId = `req-${++requestIdRef.current}`;
    pendingRequestRef.current = requestId;

    // Send detection request to worker
    setIsDetecting(true);
    const message: DetectMessage = {
      type: 'detect',
      text,
      requestId,
    };
    workerRef.current.postMessage(message);
  }, [editor, enabled, clearDecorations]);

  /**
   * Debounced detection on content change
   */
  const detectDebounced = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      detectSensitiveWords();
    }, debounceMs);
  }, [detectSensitiveWords, debounceMs]);

  /**
   * Listen to editor content changes
   */
  useEffect(() => {
    if (!editor || !enabled) {
      clearDecorations();
      return;
    }

    const model = editor.getModel();
    if (!model) {
      clearDecorations();
      return;
    }

    // Initial detection
    detectSensitiveWords();

    // Listen to content changes
    const disposable = model.onDidChangeContent(() => {
      detectDebounced();
    });

    // Cleanup
    return () => {
      disposable.dispose();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [editor, enabled, detectSensitiveWords, detectDebounced, clearDecorations]);

  /**
   * Clear decorations when disabled
   */
  useEffect(() => {
    if (!enabled) {
      clearDecorations();
    }
  }, [enabled, clearDecorations]);

  /**
   * Register hover provider for sensitive words
   */
  useEffect(() => {
    if (!editor || !enabled) {
      // Dispose existing hover provider
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    // Get monaco namespace
    const monacoInstance = (window as any).monaco;
    if (!monacoInstance || !monacoInstance.languages) {
      console.error('Monaco languages API not available');
      return;
    }

    // Get the language ID from the model
    const languageId = model.getLanguageId();

    // Create and register hover provider
    const hoverProvider = createSensitiveWordHoverProvider({
      getMatches: () => matchesRef.current,
    });

    hoverProviderRef.current = monacoInstance.languages.registerHoverProvider(
      languageId,
      hoverProvider
    );

    // Cleanup on unmount or when dependencies change
    return () => {
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
    };
  }, [editor, enabled]);

  return {
    sensitiveWordCount,
    isDetecting,
    loadDictionary,
  };
}

/**
 * Get severity text in Chinese
 */
export function getSeverityText(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'low':
      return '低';
    case 'medium':
      return '中';
    case 'high':
      return '高';
  }
}
