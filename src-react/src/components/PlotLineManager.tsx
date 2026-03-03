import React, { useEffect, useState } from 'react';
import { plotLineService, chapterService } from '../services';
import type { PlotLine, PlotLineData, PlotLineStatus } from '../services';
import type { Chapter } from '../services';
import { useI18n } from '../i18n';
import { PlotLineVisualization } from './PlotLineVisualization';
import './PlotLineManager.css';

export interface PlotLineManagerProps {
  onPlotLineClick?: (plotLine: PlotLine) => void;
  onPlotLineUpdate?: () => void;
}

/**
 * PlotLineManager Component
 * Displays and manages all plot lines in the novel
 * Supports creating, editing, deleting plot lines and visualizing them
 */
export const PlotLineManager: React.FC<PlotLineManagerProps> = ({
  onPlotLineClick,
  onPlotLineUpdate,
}) => {
  const { t } = useI18n();
  const [plotLines, setPlotLines] = useState<PlotLine[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPlotLine, setEditingPlotLine] = useState<PlotLine | null>(null);
  const [selectedPlotLine, setSelectedPlotLine] = useState<PlotLine | null>(null);

  const [formData, setFormData] = useState<PlotLineData>({
    name: '',
    startChapter: '',
    endChapter: undefined,
    status: 'ongoing',
    description: '',
  });

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [plotLineList, chapterList] = await Promise.all([
        plotLineService.listPlotLines(),
        chapterService.listChapters(),
      ]);
      setPlotLines(plotLineList);
      setChapters(chapterList);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plotLine.error.loadDataFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePlotLineClick = (plotLine: PlotLine) => {
    setSelectedPlotLine(plotLine);
    if (onPlotLineClick) {
      onPlotLineClick(plotLine);
    }
  };

  const handleCreateClick = () => {
    setShowCreateForm(true);
    setEditingPlotLine(null);
    setFormData({
      name: '',
      startChapter: chapters.length > 0 ? chapters[0].id : '',
      endChapter: undefined,
      status: 'ongoing',
      description: '',
    });
  };

  const handleEditClick = (plotLine: PlotLine) => {
    setEditingPlotLine(plotLine);
    setShowCreateForm(true);
    setFormData({
      name: plotLine.name,
      startChapter: plotLine.startChapter,
      endChapter: plotLine.endChapter,
      status: plotLine.status,
      description: plotLine.description || '',
    });
  };

  const handleCancelForm = () => {
    setShowCreateForm(false);
    setEditingPlotLine(null);
    setFormData({
      name: '',
      startChapter: '',
      endChapter: undefined,
      status: 'ongoing',
      description: '',
    });
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingPlotLine) {
        await plotLineService.updatePlotLine(editingPlotLine.id, formData);
      } else {
        await plotLineService.createPlotLine(formData);
      }

      await loadData();
      handleCancelForm();

      if (onPlotLineUpdate) {
        onPlotLineUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plotLine.error.saveFailed'));
    }
  };

  const handleDeleteClick = async (plotLineId: string) => {
    if (!window.confirm(t('plotLine.confirmDelete'))) {
      return;
    }

    try {
      await plotLineService.deletePlotLine(plotLineId);
      await loadData();

      if (selectedPlotLine?.id === plotLineId) {
        setSelectedPlotLine(null);
      }

      if (onPlotLineUpdate) {
        onPlotLineUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plotLine.error.deleteFailed'));
    }
  };

  const getStatusText = (status: PlotLineStatus) => {
    switch (status) {
      case 'ongoing':
        return t('plotLine.status.ongoing');
      case 'completed':
        return t('plotLine.status.completed');
      case 'paused':
        return t('plotLine.status.paused');
      default:
        return status;
    }
  };

  const getStatusClass = (status: PlotLineStatus) => {
    switch (status) {
      case 'ongoing':
        return 'status-ongoing';
      case 'completed':
        return 'status-completed';
      case 'paused':
        return 'status-paused';
      default:
        return '';
    }
  };

  const getChapterTitle = (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    return chapter ? chapter.title : chapterId;
  };

  if (loading) {
    return (
      <div className="plot-line-manager-loading">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="plot-line-manager">
      <div className="plot-line-manager-header">
        <h2>{t('plotLine.title')}</h2>
        <button className="btn-create" onClick={handleCreateClick}>
          + {t('plotLine.new')}
        </button>
      </div>

      {error && (
        <div className="plot-line-manager-error">
          <p>{error}</p>
          <button onClick={() => setError(null)}>{t('common.close')}</button>
        </div>
      )}

      {showCreateForm && (
        <div className="plot-line-form-overlay">
          <div className="plot-line-form">
            <h3>{editingPlotLine ? t('plotLine.form.editTitle') : t('plotLine.form.newTitle')}</h3>
            <form onSubmit={handleSubmitForm}>
              <div className="form-group">
                <label htmlFor="name">{t('plotLine.form.name')}</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder={t('plotLine.form.namePlaceholder')}
                />
              </div>

              <div className="form-group">
                <label htmlFor="startChapter">{t('plotLine.form.startChapter')}</label>
                <select
                  id="startChapter"
                  value={formData.startChapter}
                  onChange={(e) => setFormData({ ...formData, startChapter: e.target.value })}
                  required
                >
                  <option value="">{t('plotLine.form.selectChapter')}</option>
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="endChapter">{t('plotLine.form.endChapter')}</label>
                <select
                  id="endChapter"
                  value={formData.endChapter || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    endChapter: e.target.value || undefined,
                  })}
                >
                  <option value="">{t('plotLine.form.endUndecided')}</option>
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="status">{t('plotLine.form.status')}</label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData({
                    ...formData,
                    status: e.target.value as PlotLineStatus,
                  })}
                  required
                >
                  <option value="ongoing">{t('plotLine.status.ongoing')}</option>
                  <option value="completed">{t('plotLine.status.completed')}</option>
                  <option value="paused">{t('plotLine.status.paused')}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="description">{t('plotLine.form.description')}</label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('plotLine.form.descriptionPlaceholder')}
                  rows={4}
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-submit">
                  {editingPlotLine ? t('common.save') : t('plotLine.form.create')}
                </button>
                <button type="button" className="btn-cancel" onClick={handleCancelForm}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="plot-line-manager-content">
        {plotLines.length === 0 ? (
          <div className="plot-line-manager-empty">
            <p>{t('plotLine.empty')}</p>
          </div>
        ) : (
          <>
            <div className="plot-line-visualization-section">
              <h3>{t('plotLine.visualization')}</h3>
              <PlotLineVisualization
                plotLines={plotLines}
                chapters={chapters}
                onPlotLineClick={handlePlotLineClick}
              />
            </div>

            <div className="plot-line-list-section">
              <h3>{t('plotLine.list')}</h3>
              <div className="plot-line-list">
                {plotLines.map((plotLine) => (
                  <div
                    key={plotLine.id}
                    className={`plot-line-item ${selectedPlotLine?.id === plotLine.id ? 'selected' : ''}`}
                    onClick={() => handlePlotLineClick(plotLine)}
                  >
                    <div className="plot-line-item-header">
                      <h4>{plotLine.name}</h4>
                      <span className={`plot-line-status ${getStatusClass(plotLine.status)}`}>
                        {getStatusText(plotLine.status)}
                      </span>
                    </div>

                    <div className="plot-line-item-info">
                      <p>
                        <strong>{t('plotLine.startChapter')}:</strong> {getChapterTitle(plotLine.startChapter)}
                      </p>
                      <p>
                        <strong>{t('plotLine.endChapter')}:</strong>{' '}
                        {plotLine.endChapter
                          ? getChapterTitle(plotLine.endChapter)
                          : t('plotLine.form.endUndecided')}
                      </p>
                      {plotLine.description && (
                        <p className="plot-line-description">
                          <strong>{t('plotLine.description')}:</strong> {plotLine.description}
                        </p>
                      )}
                    </div>

                    <div className="plot-line-item-chapters">
                      <strong>{t('plotLine.involvedChapters')}:</strong>
                      <div className="chapter-tags">
                        {plotLine.chapters.map((chapterId) => (
                          <span key={chapterId} className="chapter-tag">
                            {getChapterTitle(chapterId)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="plot-line-item-actions">
                      <button
                        className="btn-edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(plotLine);
                        }}
                      >
                        {t('plotLine.edit')}
                      </button>
                      <button
                        className="btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteClick(plotLine.id);
                        }}
                      >
                        {t('plotLine.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
