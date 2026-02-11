# Sensitive Word Hover Provider

## Overview

The Sensitive Word Hover Provider enhances the sensitive word detection feature by providing rich hover tooltips when users hover over detected sensitive words in the Monaco Editor.

## Implementation

### Architecture

The hover functionality is implemented using Monaco Editor's Hover Provider API, which provides better integration and more control compared to inline hover messages in decorations.

**Key Components:**

1. **SensitiveWordHoverProvider** (`src/providers/SensitiveWordHoverProvider.ts`)
   - Implements Monaco's `HoverProvider` interface
   - Provides hover content for sensitive words
   - Shows word, severity, and suggestions

2. **useSensitiveWordDetection Hook** (`src/hooks/useSensitiveWordDetection.ts`)
   - Manages sensitive word detection lifecycle
   - Stores current matches in a ref for hover provider access
   - Registers/unregisters hover provider based on editor state

3. **SensitiveWordService** (`src/services/SensitiveWordService.ts`)
   - Performs actual word detection using Aho-Corasick algorithm
   - Runs in a Web Worker for performance

### How It Works

1. **Detection Phase:**
   - User types in the editor
   - Content changes are debounced (default 500ms)
   - Text is sent to Web Worker for detection
   - Matches are returned and stored in `matchesRef`

2. **Decoration Phase:**
   - Matches are converted to Monaco decorations
   - Wavy underlines are applied based on severity:
     - Low: Green (`#22c55e`)
     - Medium: Yellow (`#eab308`)
     - High: Red (`#ef4444`)

3. **Hover Phase:**
   - User hovers over a decorated word
   - Hover provider checks if cursor is over a match
   - Rich tooltip is displayed with:
     - Severity emoji (⚠️ or 🚫)
     - Word text
     - Severity level
     - Suggestion message

### Hover Content Format

```markdown
**🚫 敏感词检测**

词语: `敏感词`

严重程度: 高 (High)

---

💡 建议: 请检查此内容是否符合发布平台的要求
```

## Usage

The hover provider is automatically registered when:
- An editor instance is available
- Sensitive word detection is enabled
- A valid model exists in the editor

No manual setup is required - the `useSensitiveWordDetection` hook handles everything.

```typescript
// In your component
const { sensitiveWordCount, isDetecting, loadDictionary } = useSensitiveWordDetection({
  editor: monacoEditor,
  enabled: true,
  dictionary: ['敏感词1', '敏感词2'],
  debounceMs: 500,
});
```

## Performance Considerations

1. **Web Worker**: Detection runs in a background thread to avoid blocking the UI
2. **Debouncing**: Content changes are debounced to reduce detection frequency
3. **Efficient Algorithm**: Aho-Corasick algorithm provides O(n + m + z) complexity
4. **Lazy Hover**: Hover content is only computed when user hovers over a word

## Testing

### Unit Tests

- **SensitiveWordHoverProvider.test.ts**: Tests hover provider logic
  - Hover content generation
  - Range calculation
  - Severity display
  - Edge cases (cursor position, no matches, etc.)

- **useSensitiveWordDetection.test.ts**: Tests hook integration
  - Editor lifecycle
  - Enable/disable behavior
  - Decoration management

### Manual Testing

1. Open a file in the editor
2. Type a sensitive word from the dictionary
3. Wait for the wavy underline to appear
4. Hover over the word
5. Verify the tooltip appears with correct information

## Requirements Validation

This implementation satisfies:

- **Requirement 11.3**: "WHEN 用户悬停在敏感词上，THE System SHALL 显示提示信息"
  - ✅ Uses Monaco Editor's Hover Provider API
  - ✅ Displays rich tooltip with word, severity, and suggestions
  - ✅ Integrates seamlessly with editor's hover system

## Future Enhancements

Potential improvements:
1. Add quick actions in hover (e.g., "Ignore this word", "Add to whitelist")
2. Show alternative word suggestions
3. Display context-specific severity explanations
4. Support custom hover content templates
5. Add keyboard shortcut to show hover programmatically
