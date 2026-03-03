import React, { useState } from 'react';
import type { Character, CharacterData } from '../services';
import { useI18n } from '../i18n';
import './CharacterCard.css';

export interface CharacterCardProps {
  character: Character;
  onUpdate?: (id: string, data: Partial<CharacterData>) => void;
  onDelete?: (id: string) => void;
  initialMode?: 'view' | 'edit';
}

/**
 * CharacterCard Component
 * Displays character information in card format
 * Supports view mode and edit mode switching
 */
export const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  onUpdate,
  onDelete,
  initialMode = 'view',
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [editData, setEditData] = useState<CharacterData>(character.data);
  const [isSaving, setIsSaving] = useState(false);

  const handleEdit = () => {
    setEditData(character.data);
    setMode('edit');
  };

  const handleCancel = () => {
    setEditData(character.data);
    setMode('view');
  };

  const handleSave = async () => {
    if (!onUpdate) return;

    try {
      setIsSaving(true);
      await onUpdate(character.id, editData);
      setMode('view');
    } catch (error) {
      console.error('Failed to save character:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!onDelete) return;

    if (window.confirm(t('character.card.confirmDelete', { name: character.name }))) {
      onDelete(character.id);
    }
  };

  const handleFieldChange = (field: keyof CharacterData, value: string) => {
    setEditData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const renderField = (
    label: string,
    field: keyof CharacterData,
    multiline = false,
  ) => {
    const value = character.data[field] || '';
    const editValue = editData[field] || '';

    if (mode === 'view') {
      return (
        <div className="character-field">
          <div className="field-label">{label}</div>
          <div className="field-value">
            {value || <span className="field-empty">{t('character.card.empty')}</span>}
          </div>
        </div>
      );
    }

    return (
      <div className="character-field">
        <label className="field-label" htmlFor={`${character.id}-${field}`}>
          {label}
        </label>
        {multiline ? (
          <textarea
            id={`${character.id}-${field}`}
            className="field-input field-textarea"
            value={editValue}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            placeholder={t('character.card.enterField', { label })}
            rows={4}
          />
        ) : (
          <input
            id={`${character.id}-${field}`}
            type="text"
            className="field-input"
            value={editValue}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            placeholder={t('character.card.enterField', { label })}
          />
        )}
      </div>
    );
  };

  return (
    <div className="character-card">
      <div className="character-card-header">
        <h3 className="character-name">{character.name}</h3>
        <div className="character-actions">
          {mode === 'view' ? (
            <>
              <button
                className="action-button action-edit"
                onClick={handleEdit}
                title={t('character.card.action.edit')}
              >
                {t('character.card.action.edit')}
              </button>
              {onDelete && (
                <button
                  className="action-button action-delete"
                  onClick={handleDelete}
                  title={t('character.card.action.delete')}
                >
                  {t('character.card.action.delete')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="action-button action-save"
                onClick={handleSave}
                disabled={isSaving}
                title={t('character.card.action.save')}
              >
                {isSaving ? t('character.card.action.saving') : t('character.card.action.save')}
              </button>
              <button
                className="action-button action-cancel"
                onClick={handleCancel}
                disabled={isSaving}
                title={t('character.card.action.cancel')}
              >
                {t('character.card.action.cancel')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="character-card-body">
        {renderField(t('character.card.field.name'), 'name')}
        {renderField(t('character.card.field.appearance'), 'appearance', true)}
        {renderField(t('character.card.field.personality'), 'personality', true)}
        {renderField(t('character.card.field.background'), 'background', true)}
        {renderField(t('character.card.field.relationships'), 'relationships', true)}
        {renderField(t('character.card.field.notes'), 'notes', true)}
      </div>
    </div>
  );
};
