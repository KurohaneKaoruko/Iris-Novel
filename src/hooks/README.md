# React Hooks

This directory contains custom React hooks for the AI Novel Editor.

## useSensitiveWordDetection

Hook for integrating sensitive word detection with Monaco Editor.

### Features

- **Real-time detection**: Detects sensitive words as the user types
- **Background processing**: Uses Web Worker to avoid blocking the UI thread
- **Visual feedback**: Marks sensitive words with wavy underlines
- **Severity levels**: Supports low, medium, and high severity with different colors
- **Debounced updates**: Optimizes performance by debouncing detection requests
- **Customizable dictionary**: Supports loading custom word lists

### Usage

```typescript
import { useSensitiveWordDetection } from './hooks/useSensitiveWordDetection';

function MyEditor() {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [enabled, setEnabled] = useState(true);
  
  const { sensitiveWordCount, isDetecting, loadDictionary } = useSensitiveWordDetection({
    editor: editorRef.current,
    enabled: enabled,
    dictionary: ['敏感词1', '敏感词2', '敏感词3'],
    debounceMs: 500, // Optional, defaults to 500ms
  });

  return (
    <div>
      <div>检测到 {sensitiveWordCount} 个敏感词</div>
      <Editor
        onMount={(editor) => {
          editorRef.current = editor;
        }}
      />
    </div>
  );
}
```

### Options

- `editor`: Monaco editor instance (required)
- `enabled`: Whether detection is enabled (required)
- `dictionary`: Array of sensitive words to detect (optional, defaults to empty array)
- `debounceMs`: Debounce delay in milliseconds (optional, defaults to 500)

### Return Values

- `sensitiveWordCount`: Number of sensitive words detected in the current document
- `isDetecting`: Whether detection is currently in progress
- `loadDictionary`: Function to load a new dictionary

### Styling

The hook applies CSS classes to detected words. You need to include the sensitive word styles:

```typescript
import './styles/sensitiveWord.css';
```

The following CSS classes are used:

- `.sensitive-word-decoration-low`: Green wavy underline (low severity)
- `.sensitive-word-decoration-medium`: Yellow wavy underline (medium severity)
- `.sensitive-word-decoration-high`: Red wavy underline (high severity)
- `.sensitive-word-decoration`: Orange wavy underline (default)

### Requirements

This hook implements the following requirements:

- **Requirement 11.1**: Real-time sensitive word detection in the editor
- **Requirement 11.2**: Visual marking with wavy underlines
- **Requirement 15.4**: Background thread execution using Web Worker

### Performance

The hook is optimized for performance:

- Detection runs in a Web Worker to avoid blocking the UI
- Updates are debounced to reduce unnecessary processing
- Only the latest detection request is processed (older requests are ignored)
- Decorations are efficiently updated using Monaco's delta decorations API

### Browser Support

Requires browsers that support:

- Web Workers
- ES6 Modules in Workers
- Monaco Editor

### See Also

- [SensitiveWordService](../services/SensitiveWordService.ts) - The underlying detection service
- [Sensitive Word Worker](../workers/sensitiveWord.worker.ts) - The Web Worker implementation
