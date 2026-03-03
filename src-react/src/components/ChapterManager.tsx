import React, { useEffect, useState } from 'react';
import { chapterService } from '../services';
import type { Chapter } from '../services';
import { useI18n } from '../i18n';
import './ChapterManager.css';

export interface ChapterManagerProps {
  onChapterClick?: (chapter: Chapter) => void;
  onChapterUpdate?: () => void;
}

/**
 * ChapterManager Component
 * Displays and manages all chapters in the novel
 * Supports drag-and-drop reordering, status updates, and statistics
 */
export const ChapterManager: React.FC<ChapterManagerProps> = ({
  onChapterClick,
}) => {
  const { t } = useI18n();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadChapters();
  }, []);

  const loadChapters = async () => {
    try {
      setLoading(true);
      setError(null);
      const chapterList = await chapterService.listChapters();
      setChapters(chapterList);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chapter.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChapterClick = (chapter: Chapter) => {
    if (onChapterClick) {
      onChapterClick(chapter);
    }
  };

  const totalStats = React.useMemo(() => {
    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const totalChapters = chapters.length;
    return {
      totalWordCount,
      totalChapters,
    };
  }, [chapters]);

  if (loading) {
    return (
      <div className="chapter-manager">
        <div className="chapter-manager-loading">{t('common.loading')}</div>
      </div>
    );
  }

  if (error && chapters.length === 0) {
    return (
      <div className="chapter-manager">
        <div className="chapter-manager-error">
          <p>{t('chapter.error.prefix')}: {error}</p>
          <button onClick={() => void loadChapters()}>{t('common.retry')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chapter-manager">
      {error && chapters.length > 0 && (
        <div className="chapter-manager-error-banner">
          <span>{t('chapter.error.prefix')}: {error}</span>
          <button onClick={() => setError(null)}>{t('common.close')}</button>
        </div>
      )}

      <div className="chapter-manager-header chapter-manager-header-compact">
        <div className="chapter-manager-header-row">
          <span className="chapter-manager-header-title">{t('chapter.title')}</span>
          <span className="chapter-manager-header-meta">
            {t('chapter.meta', { count: chapters.length, words: totalStats.totalWordCount.toLocaleString() })}
          </span>
        </div>
      </div>

      <div className="chapter-list chapter-list-compact">
        {chapters.length === 0 ? (
          <div className="chapter-list-empty chapter-list-empty-compact">
            <p className="chapter-list-empty-text">{t('chapter.empty')}</p>
          </div>
        ) : (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className="chapter-item chapter-item-compact"
              onClick={() => handleChapterClick(chapter)}
            >
              <span className="chapter-item-title-compact">{chapter.title}</span>
              <span className="chapter-item-meta-compact">
                {chapter.wordCount.toLocaleString()} {t('chapter.wordsUnit')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
