import React, { useCallback, useEffect, useState } from 'react';
import { characterService, type Character, type CharacterData } from '../services';
import { useI18n } from '../i18n';
import { CharacterCard } from './CharacterCard';
import './CharacterManager.css';

export interface CharacterManagerProps {
  onCharacterClick?: (character: Character) => void;
}

/**
 * CharacterManager Component
 * Displays all character cards in grid or list view
 * Supports search, filtering, create, edit, and delete operations
 */
export const CharacterManager: React.FC<CharacterManagerProps> = ({
  onCharacterClick,
}) => {
  const { t } = useI18n();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<Character[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCharacterData, setNewCharacterData] = useState<CharacterData>({
    name: '',
  });

  useEffect(() => {
    void loadCharacters();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredCharacters(characters);
      return;
    }

    const performSearch = async () => {
      try {
        const results = await characterService.searchCharacters(searchQuery);
        setFilteredCharacters(results);
      } catch (err) {
        console.error('Search failed:', err);
        setFilteredCharacters(characters);
      }
    };

    void performSearch();
  }, [searchQuery, characters]);

  const loadCharacters = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedCharacters = await characterService.listCharacters();
      setCharacters(loadedCharacters);
      setFilteredCharacters(loadedCharacters);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCreateCharacter = useCallback(async () => {
    if (!newCharacterData.name.trim()) {
      setError(t('character.manager.errorNameRequired'));
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await characterService.createCharacter(newCharacterData);
      await loadCharacters();
      setShowCreateForm(false);
      setNewCharacterData({ name: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [newCharacterData, loadCharacters, t]);

  const handleUpdateCharacter = useCallback(
    async (id: string, data: Partial<CharacterData>) => {
      setIsLoading(true);
      setError(null);
      try {
        await characterService.updateCharacter(id, data);
        await loadCharacters();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [loadCharacters],
  );

  const handleDeleteCharacter = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await characterService.deleteCharacter(id);
        await loadCharacters();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [loadCharacters],
  );

  const handleCancelCreate = useCallback(() => {
    setShowCreateForm(false);
    setNewCharacterData({ name: '' });
    setError(null);
  }, []);

  const handleNewCharacterFieldChange = useCallback((field: keyof CharacterData, value: string) => {
    setNewCharacterData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  return (
    <div className="character-manager">
      <div className="character-manager-header">
        <h2 className="character-manager-title">{t('character.manager.title')}</h2>
        <div className="character-manager-stats">
          {t('character.manager.stats', { count: characters.length })}
        </div>
      </div>

      <div className="character-manager-toolbar">
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder={t('character.manager.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              title={t('character.manager.clearSearch')}
            >
              {t('character.manager.clear')}
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          <div className="view-mode-toggle">
            <button
              className={`view-mode-button ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title={t('character.manager.gridView')}
            >
              {t('character.manager.grid')}
            </button>
            <button
              className={`view-mode-button ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title={t('character.manager.listView')}
            >
              {t('character.manager.list')}
            </button>
          </div>

          <button
            className="create-button"
            onClick={() => setShowCreateForm(true)}
            disabled={isLoading}
          >
            + {t('character.manager.createButton')}
          </button>
        </div>
      </div>

      {error && (
        <div className="character-manager-error">
          <span className="error-icon">{t('character.manager.error')}</span>
          {error}
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="create-character-form">
          <div className="form-header">
            <h3>{t('character.manager.createTitle')}</h3>
            <button
              className="form-close"
              onClick={handleCancelCreate}
            >
              {t('common.close')}
            </button>
          </div>
          <div className="form-body">
            <div className="form-field">
              <label htmlFor="new-character-name">
                {t('character.card.field.name')} <span className="required">*</span>
              </label>
              <input
                id="new-character-name"
                type="text"
                className="form-input"
                value={newCharacterData.name}
                onChange={(e) =>
                  handleNewCharacterFieldChange('name', e.target.value)
                }
                placeholder={t('character.manager.placeholder.name')}
                autoFocus
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-appearance">{t('character.card.field.appearance')}</label>
              <textarea
                id="new-character-appearance"
                className="form-textarea"
                value={newCharacterData.appearance || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('appearance', e.target.value)
                }
                placeholder={t('character.manager.placeholder.appearance')}
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-personality">{t('character.card.field.personality')}</label>
              <textarea
                id="new-character-personality"
                className="form-textarea"
                value={newCharacterData.personality || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('personality', e.target.value)
                }
                placeholder={t('character.manager.placeholder.personality')}
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-background">{t('character.card.field.background')}</label>
              <textarea
                id="new-character-background"
                className="form-textarea"
                value={newCharacterData.background || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('background', e.target.value)
                }
                placeholder={t('character.manager.placeholder.background')}
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-relationships">{t('character.card.field.relationships')}</label>
              <textarea
                id="new-character-relationships"
                className="form-textarea"
                value={newCharacterData.relationships || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('relationships', e.target.value)
                }
                placeholder={t('character.manager.placeholder.relationships')}
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-notes">{t('character.card.field.notes')}</label>
              <textarea
                id="new-character-notes"
                className="form-textarea"
                value={newCharacterData.notes || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('notes', e.target.value)
                }
                placeholder={t('character.manager.placeholder.notes')}
                rows={3}
              />
            </div>
          </div>
          <div className="form-footer">
            <button
              className="form-button form-button-cancel"
              onClick={handleCancelCreate}
              disabled={isLoading}
            >
              {t('common.cancel')}
            </button>
            <button
              className="form-button form-button-submit"
              onClick={() => void handleCreateCharacter()}
              disabled={isLoading || !newCharacterData.name.trim()}
            >
              {isLoading ? t('character.manager.creating') : t('character.manager.create')}
            </button>
          </div>
        </div>
      )}

      {isLoading && !showCreateForm && (
        <div className="character-manager-loading">
          <div className="loading-spinner"></div>
          <p>{t('common.loading')}</p>
        </div>
      )}

      {!isLoading && filteredCharacters.length === 0 && !showCreateForm && (
        <div className="character-manager-empty">
          {searchQuery ? (
            <>
              <p>{t('character.manager.empty.search')}</p>
              <button
                className="empty-action"
                onClick={() => setSearchQuery('')}
              >
                {t('character.manager.clearSearch')}
              </button>
            </>
          ) : (
            <>
              <p>{t('character.manager.empty.none')}</p>
              <button
                className="empty-action"
                onClick={() => setShowCreateForm(true)}
              >
                {t('character.manager.empty.createFirst')}
              </button>
            </>
          )}
        </div>
      )}

      {!isLoading && filteredCharacters.length > 0 && (
        <div className={`character-list ${viewMode}`}>
          {filteredCharacters.map((character) => (
            <div
              key={character.id}
              className="character-list-item"
              onClick={() => onCharacterClick?.(character)}
            >
              <CharacterCard
                character={character}
                onUpdate={handleUpdateCharacter}
                onDelete={handleDeleteCharacter}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
