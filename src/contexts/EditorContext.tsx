import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type * as monaco from 'monaco-editor';
import { writingGoalService } from '../services';

/**
 * Represents an open file in the editor
 */
export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  language?: string;
}

/**
 * Editor state for a specific file
 */
export interface EditorState {
  cursorPosition?: monaco.IPosition;
  scrollPosition?: number;
  selections?: monaco.ISelection[];
  viewState?: monaco.editor.ICodeEditorViewState;
}

/**
 * State managed by EditorContext
 */
interface EditorContextState {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  decorations: Map<string, monaco.editor.IEditorDecorationsCollection>;
  editorStates: Map<string, EditorState>;
}

/**
 * Actions available in EditorContext
 */
interface EditorContextValue extends EditorContextState {
  // File management
  openFile: (file: OpenFile) => void;
  closeFile: (filePath: string) => void;
  updateFileContent: (filePath: string, content: string) => void;
  markFileDirty: (filePath: string, isDirty: boolean) => void;
  getFile: (filePath: string) => OpenFile | undefined;
  isFileOpen: (filePath: string) => boolean;
  
  // Active file management
  setActiveFile: (filePath: string | null) => void;
  getActiveFile: () => OpenFile | undefined;
  
  // Decorations management
  setDecorations: (filePath: string, decorations: monaco.editor.IEditorDecorationsCollection) => void;
  getDecorations: (filePath: string) => monaco.editor.IEditorDecorationsCollection | undefined;
  clearDecorations: (filePath: string) => void;
  clearAllDecorations: () => void;
  
  // Editor state management (for caching cursor position, scroll, etc.)
  saveEditorState: (filePath: string, state: EditorState) => void;
  getEditorState: (filePath: string) => EditorState | undefined;
  clearEditorState: (filePath: string) => void;
  
  // Word count tracking
  getTotalWordCount: () => number;
  
  // Utility methods
  hasOpenFiles: () => boolean;
  getOpenFileCount: () => number;
  getDirtyFiles: () => OpenFile[];
}

// Create context with undefined default value
const EditorContext = createContext<EditorContextValue | undefined>(undefined);

/**
 * Props for EditorProvider component
 */
interface EditorProviderProps {
  children: ReactNode;
}

/**
 * Provider component for EditorContext
 * Manages open files, active file, decorations, and editor states
 */
export const EditorProvider: React.FC<EditorProviderProps> = ({ children }) => {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [decorations, setDecorationsState] = useState<Map<string, monaco.editor.IEditorDecorationsCollection>>(new Map());
  const [editorStates, setEditorStates] = useState<Map<string, EditorState>>(new Map());
  
  // Word count tracking
  const wordCountTimerRef = useRef<number | null>(null);
  const lastWordCountRef = useRef<number>(0);

  /**
   * Calculate total word count from all open files
   */
  const calculateTotalWordCount = useCallback(() => {
    let totalWords = 0;
    
    for (const file of openFiles) {
      // Only count words in text files (stories, concept, outline)
      if (file.path.includes('stories/') || file.path.includes('concept/') || file.path.includes('outline/')) {
        const words = file.content.trim().split(/\s+/).filter(w => w.length > 0);
        totalWords += words.length;
      }
    }
    
    return totalWords;
  }, [openFiles]);

  /**
   * Get total word count
   */
  const getTotalWordCount = useCallback(() => {
    return calculateTotalWordCount();
  }, [calculateTotalWordCount]);

  /**
   * Record progress to writing goal service (debounced)
   */
  const recordProgressDebounced = useCallback(() => {
    // Clear existing timer
    if (wordCountTimerRef.current) {
      clearTimeout(wordCountTimerRef.current);
    }

    // Set new timer to record progress after 2 seconds of inactivity
    wordCountTimerRef.current = setTimeout(async () => {
      try {
        const currentWordCount = calculateTotalWordCount();
        
        // Only record if word count has changed
        if (currentWordCount !== lastWordCountRef.current) {
          await writingGoalService.recordProgress(currentWordCount);
          lastWordCountRef.current = currentWordCount;
        }
      } catch (error) {
        console.error('Failed to record writing progress:', error);
      }
    }, 2000);
  }, [calculateTotalWordCount]);

  /**
   * Effect to track word count changes
   */
  useEffect(() => {
    // Record progress when files change
    recordProgressDebounced();

    // Cleanup timer on unmount
    return () => {
      if (wordCountTimerRef.current) {
        clearTimeout(wordCountTimerRef.current);
      }
    };
  }, [openFiles, recordProgressDebounced]);

  /**
   * Open a file in the editor
   */
  const openFile = useCallback((file: OpenFile) => {
    setOpenFiles(prev => {
      // Check if file is already open
      const existingIndex = prev.findIndex(f => f.path === file.path);
      if (existingIndex >= 0) {
        // Update existing file
        const next = [...prev];
        next[existingIndex] = file;
        return next;
      }
      // Add new file
      return [...prev, file];
    });
    
    // Set as active file
    setActiveFilePath(file.path);
  }, []);

  /**
   * Close a file
   */
  const closeFile = useCallback((filePath: string) => {
    setOpenFiles(prev => prev.filter(f => f.path !== filePath));
    
    // Clear active file if it was closed
    setActiveFilePath(prev => prev === filePath ? null : prev);
    
    // Clear decorations and editor state for the closed file
    setDecorationsState(prev => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
    
    setEditorStates(prev => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  /**
   * Update the content of an open file
   */
  const updateFileContent = useCallback((filePath: string, content: string) => {
    setOpenFiles(prev => {
      const index = prev.findIndex(f => f.path === filePath);
      if (index < 0) return prev;
      
      const next = [...prev];
      next[index] = { ...next[index], content };
      return next;
    });
  }, []);

  /**
   * Mark a file as dirty or clean
   */
  const markFileDirty = useCallback((filePath: string, isDirty: boolean) => {
    setOpenFiles(prev => {
      const index = prev.findIndex(f => f.path === filePath);
      if (index < 0) return prev;
      
      const next = [...prev];
      next[index] = { ...next[index], isDirty };
      return next;
    });
  }, []);

  /**
   * Get a file by path
   */
  const getFile = useCallback((filePath: string): OpenFile | undefined => {
    return openFiles.find(f => f.path === filePath);
  }, [openFiles]);

  /**
   * Check if a file is open
   */
  const isFileOpen = useCallback((filePath: string): boolean => {
    return openFiles.some(f => f.path === filePath);
  }, [openFiles]);

  /**
   * Set the active file
   */
  const setActiveFile = useCallback((filePath: string | null) => {
    setActiveFilePath(filePath);
  }, []);

  /**
   * Get the active file
   */
  const getActiveFile = useCallback((): OpenFile | undefined => {
    if (!activeFilePath) return undefined;
    return openFiles.find(f => f.path === activeFilePath);
  }, [activeFilePath, openFiles]);

  /**
   * Set decorations for a file
   */
  const setDecorations = useCallback((filePath: string, decorationsCollection: monaco.editor.IEditorDecorationsCollection) => {
    setDecorationsState(prev => {
      const next = new Map(prev);
      next.set(filePath, decorationsCollection);
      return next;
    });
  }, []);

  /**
   * Get decorations for a file
   */
  const getDecorations = useCallback((filePath: string): monaco.editor.IEditorDecorationsCollection | undefined => {
    return decorations.get(filePath);
  }, [decorations]);

  /**
   * Clear decorations for a file
   */
  const clearDecorations = useCallback((filePath: string) => {
    setDecorationsState(prev => {
      const next = new Map(prev);
      const decorationsCollection = next.get(filePath);
      if (decorationsCollection) {
        decorationsCollection.clear();
        next.delete(filePath);
      }
      return next;
    });
  }, []);

  /**
   * Clear all decorations
   */
  const clearAllDecorations = useCallback(() => {
    decorations.forEach(decorationsCollection => {
      decorationsCollection.clear();
    });
    setDecorationsState(new Map());
  }, [decorations]);

  /**
   * Save editor state for a file (cursor position, scroll, etc.)
   */
  const saveEditorState = useCallback((filePath: string, state: EditorState) => {
    setEditorStates(prev => {
      const next = new Map(prev);
      next.set(filePath, state);
      return next;
    });
  }, []);

  /**
   * Get saved editor state for a file
   */
  const getEditorState = useCallback((filePath: string): EditorState | undefined => {
    return editorStates.get(filePath);
  }, [editorStates]);

  /**
   * Clear editor state for a file
   */
  const clearEditorState = useCallback((filePath: string) => {
    setEditorStates(prev => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  /**
   * Check if there are any open files
   */
  const hasOpenFiles = useCallback(() => {
    return openFiles.length > 0;
  }, [openFiles]);

  /**
   * Get the number of open files
   */
  const getOpenFileCount = useCallback(() => {
    return openFiles.length;
  }, [openFiles]);

  /**
   * Get all dirty (unsaved) files
   */
  const getDirtyFiles = useCallback(() => {
    return openFiles.filter(f => f.isDirty);
  }, [openFiles]);

  const value: EditorContextValue = {
    openFiles,
    activeFilePath,
    decorations,
    editorStates,
    openFile,
    closeFile,
    updateFileContent,
    markFileDirty,
    getFile,
    isFileOpen,
    setActiveFile,
    getActiveFile,
    setDecorations,
    getDecorations,
    clearDecorations,
    clearAllDecorations,
    saveEditorState,
    getEditorState,
    clearEditorState,
    getTotalWordCount,
    hasOpenFiles,
    getOpenFileCount,
    getDirtyFiles,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

/**
 * Hook to access EditorContext
 * @throws Error if used outside of EditorProvider
 */
export const useEditor = (): EditorContextValue => {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
};
