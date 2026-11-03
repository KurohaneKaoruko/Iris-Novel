/**
 * 作品级统计服务：聚合章节字数、资料数量、写作历史，为统计面板与进度追踪提供数据。
 *
 * 数据来源：
 * - 章节与字数：ChapterService（stories/ 目录实时统计）
 * - 写作历史：WritingGoalService（.novel/.history/writing-history.json）
 * - 资料数量：workspace tree（concept/ outline/ 文件数）
 */

import { chapterService } from './ChapterService';
import { writingGoalService } from './WritingGoalService';
import { callCommand } from '../transport';
import type { Chapter } from './ChapterService';
import type { FsEntry } from '../tauri';

export interface WorkStats {
  totalWords: number;
  chapterCount: number;
  completedChapters: number;
  conceptCount: number;
  outlineCount: number;
  daysWriting: number;
  avgWordsPerDay: number;
  todayWords: number;
  longestChapter?: { title: string; words: number };
  shortestChapter?: { title: string; words: number };
  lastUpdated: number;
}

async function countDirFiles(dirName: string): Promise<number> {
  try {
    const tree = await callCommand<FsEntry>('list_workspace_tree', { maxDepth: 2 });
    const dir = tree.children?.find((c) => c.name === dirName && c.kind === 'dir');
    if (!dir?.children) return 0;
    return dir.children.filter((c) => c.kind === 'file' && /\.md$/i.test(c.name)).length;
  } catch {
    return 0;
  }
}

function chapterWords(c: Chapter): number {
  return c.wordCount;
}

export class WorkStatsService {
  /**
   * 汇总当前作品的统计信息。任何子项失败都降级为 0，不阻塞整体。
   */
  async getWorkStats(): Promise<WorkStats> {
    const [chapters, conceptCount, outlineCount, todayStats, history] = await Promise.all([
      chapterService.listChapters().catch(() => [] as Chapter[]),
      countDirFiles('concept'),
      countDirFiles('outline'),
      writingGoalService.getTodayStats().catch(() => null),
      writingGoalService.getHistory(365).catch(() => [] as { date: string; wordCount: number; goal: number; achieved: boolean }[]),
    ]);

    const totalWords = chapters.reduce((sum, c) => sum + chapterWords(c), 0);
    const completedChapters = chapters.filter((c) => c.status === 'completed').length;

    let longest: { title: string; words: number } | undefined;
    let shortest: { title: string; words: number } | undefined;
    for (const c of chapters) {
      const words = chapterWords(c);
      if (words <= 0) continue;
      if (!longest || words > longest.words) longest = { title: c.title, words };
      if (!shortest || words < shortest.words) shortest = { title: c.title, words };
    }

    const daysWriting = history.length;
    const avgWordsPerDay = daysWriting > 0 ? Math.round(totalWords / daysWriting) : 0;

    const lastModified = chapters.reduce((max, c) => Math.max(max, c.lastModified), 0);

    return {
      totalWords,
      chapterCount: chapters.length,
      completedChapters,
      conceptCount,
      outlineCount,
      daysWriting,
      avgWordsPerDay,
      todayWords: todayStats?.wordCount ?? 0,
      longestChapter: longest,
      shortestChapter: shortest,
      lastUpdated: lastModified,
    };
  }

  /**
   * 进度追踪数据（ProgressTracker 三环）。
   * targetWords 为作品目标字数；dailyGoal 来自写作目标设置。
   */
  async getProgress(targetWords?: number): Promise<{
    totalWords: number;
    targetWords: number;
    chapters: number;
    completedChapters: number;
    dailyTarget: number;
    todayWords: number;
  }> {
    const [chapters, goal, todayStats] = await Promise.all([
      chapterService.listChapters().catch(() => [] as Chapter[]),
      writingGoalService.getCurrentGoal().catch(() => null),
      writingGoalService.getTodayStats().catch(() => null),
    ]);
    const totalWords = chapters.reduce((sum, c) => sum + chapterWords(c), 0);
    return {
      totalWords,
      targetWords: targetWords && targetWords > 0 ? targetWords : 0,
      chapters: chapters.length,
      completedChapters: chapters.filter((c) => c.status === 'completed').length,
      dailyTarget: goal?.dailyWordCount ?? 0,
      todayWords: todayStats?.wordCount ?? 0,
    };
  }
}

export const workStatsService = new WorkStatsService();
