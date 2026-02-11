# Sensitive Word Configuration UI Implementation

## Overview

This document describes the implementation of the sensitive word configuration interface in the settings modal (Task 9.5).

## Requirements

- **11.4**: Support custom sensitive word dictionary
- **11.5**: Provide sensitive word detection toggle

## Implementation

### 1. UI Components

The sensitive word configuration is integrated into the existing settings modal in `src/App.tsx`. It includes:

#### Toggle Switch
- **Location**: Settings Modal → 敏感词检测 section
- **Function**: Enable/disable sensitive word detection
- **State**: `sensitiveWordEnabled` (boolean)

#### Custom Word Management
- **Input Field**: Text input for adding new sensitive words
- **Add Button**: Adds the word to the dictionary
- **Word List**: Displays all custom sensitive words as tags
- **Delete Buttons**: Remove individual words from the dictionary
- **Word Count**: Shows total number of words in dictionary

### 2. State Management

```typescript
// State variables
const [sensitiveWordEnabled, setSensitiveWordEnabled] = useState(true)
const [sensitiveWordDictionary, setSensitiveWordDictionary] = useState<string[]>([])
const [newSensitiveWord, setNewSensitiveWord] = useState('')
```

### 3. Event Handlers

#### Adding Words
```typescript
const onAddSensitiveWord = useCallback(() => {
  const word = newSensitiveWord.trim()
  if (!word) return
  if (sensitiveWordDictionary.includes(word)) {
    setNewSensitiveWord('')
    return
  }
  setSensitiveWordDictionary((prev) => [...prev, word])
  setNewSensitiveWord('')
}, [newSensitiveWord, sensitiveWordDictionary])
```

#### Removing Words
```typescript
const onRemoveSensitiveWord = useCallback((word: string) => {
  setSensitiveWordDictionary((prev) => prev.filter((w) => w !== word))
}, [])
```

### 4. Persistence

Settings are automatically saved to `.novel/.settings/sensitive-words.json`:

```json
{
  "enabled": true,
  "dictionary": ["暴力", "血腥", "色情", "政治", "敏感"]
}
```

#### Loading Settings
```typescript
const loadSensitiveWordSettings = useCallback(async () => {
  if (!workspaceRoot) return
  try {
    const raw = await readText('.novel/.settings/sensitive-words.json')
    const v: unknown = JSON.parse(raw)
    if (typeof v === 'object' && v) {
      const data = v as { enabled?: boolean; dictionary?: string[] }
      if (typeof data.enabled === 'boolean') {
        setSensitiveWordEnabled(data.enabled)
      }
      if (Array.isArray(data.dictionary)) {
        setSensitiveWordDictionary(data.dictionary)
      }
    }
  } catch {
    // Use defaults if file doesn't exist
    return
  }
}, [workspaceRoot])
```

#### Saving Settings
```typescript
const saveSensitiveWordSettings = useCallback(async () => {
  if (!workspaceRoot) return
  if (isTauriApp()) {
    try {
      await initNovel()
    } catch {
      return
    }
  }
  const raw = JSON.stringify(
    {
      enabled: sensitiveWordEnabled,
      dictionary: sensitiveWordDictionary,
    },
    null,
    2
  )
  await writeText('.novel/.settings/sensitive-words.json', raw)
}, [workspaceRoot, sensitiveWordEnabled, sensitiveWordDictionary])
```

#### Auto-save on Change
Settings are automatically saved 500ms after any change:

```typescript
useEffect(() => {
  if (!workspaceRoot) return
  const timer = setTimeout(() => {
    void saveSensitiveWordSettings()
  }, 500)
  return () => clearTimeout(timer)
}, [sensitiveWordEnabled, sensitiveWordDictionary, saveSensitiveWordSettings, workspaceRoot])
```

### 5. Integration with Detection

The `useSensitiveWordDetection` hook automatically receives the updated dictionary:

```typescript
const { sensitiveWordCount, isDetecting: isSensitiveWordDetecting } = useSensitiveWordDetection({
  editor: editorRef.current,
  enabled: sensitiveWordEnabled && activePath !== null,
  dictionary: sensitiveWordDictionary,
  debounceMs: 500,
})
```

When the dictionary changes, the hook's internal effect triggers and loads the new dictionary into the Web Worker.

## User Workflow

1. **Open Settings**: Click the settings button to open the settings modal
2. **Navigate to Section**: Scroll to the "敏感词检测" section
3. **Toggle Detection**: Use the checkbox to enable/disable detection
4. **Add Words**: 
   - Type a word in the input field
   - Click "添加" or press Enter
   - Word appears in the list below
5. **Remove Words**: Click the × button next to any word to remove it
6. **View Count**: See the total word count at the bottom
7. **Auto-save**: Changes are automatically saved after 500ms

## Features

### Duplicate Prevention
The system prevents adding duplicate words to the dictionary.

### Keyboard Support
- Press Enter in the input field to add a word
- No need to click the button

### Visual Feedback
- Words are displayed as tags with delete buttons
- Empty state message when no words exist
- Word count display
- Disabled state for add button when input is empty

### Persistence
- Settings are saved to `.novel/.settings/sensitive-words.json`
- Settings are loaded when workspace is opened
- Auto-save with 500ms debounce

## File Structure

```
src/
├── App.tsx                          # Main app with settings modal
├── hooks/
│   └── useSensitiveWordDetection.ts # Detection hook
├── services/
│   └── SensitiveWordService.ts      # Detection service
└── workers/
    └── sensitiveWord.worker.ts      # Web Worker for detection

.novel/.settings/
└── sensitive-words.json             # Persisted settings
```

## Testing

Basic test structure is provided in `__tests__/components/SensitiveWordConfig.test.tsx`.

## Future Enhancements

1. **Import/Export**: Allow importing/exporting word lists
2. **Categories**: Organize words by category (violence, politics, etc.)
3. **Severity Levels**: Allow setting severity for each word
4. **Regex Support**: Support regex patterns in addition to exact words
5. **Shared Dictionaries**: Share dictionaries across projects
6. **Cloud Sync**: Sync dictionaries across devices

## Related Requirements

- **Requirement 11.1**: Real-time sensitive word detection
- **Requirement 11.2**: Wavy underline marking
- **Requirement 11.3**: Hover tooltip
- **Requirement 11.4**: Custom dictionary support ✓
- **Requirement 11.5**: Detection toggle ✓
- **Requirement 11.6**: Status bar word count

## Conclusion

The sensitive word configuration interface provides a user-friendly way to manage the sensitive word dictionary and toggle detection on/off. It integrates seamlessly with the existing settings modal and automatically persists changes to the workspace configuration.
