import { FlatList, ScrollView, Text, View } from 'react-native';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalViewport } from '@/components/AppModalViewport';
import { UiListItem } from '@/components/UiRedesign';
import { useTheme } from '@/hooks/useTheme';
import { formatDateTimeExport } from '@/utils/time';
import type { IsolatedWorkDraft } from '@/utils/workDraftIsolation';
import type { createStyles } from './styles';

type DialogStyles = ReturnType<typeof createStyles>;

export function DraftArchiveDialog({ styles, archives, selectedId, restoring, onClose, onSelect, onRestore }: {
  styles: DialogStyles;
  archives: IsolatedWorkDraft[];
  selectedId: string | null;
  restoring: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRestore: () => void;
}) {
  const { theme } = useTheme();
  const [contentHeight, setContentHeight] = useState<number>();
  return <AppModalViewport style={styles.updateModalOverlay}>
    <AppModalCard title="恢复前作业副本" size="list" bodyContentHeight={contentHeight} stretchBody scrollMode="body"
      subtitle="副本不会自动写回业务记录。请先核对单据和实物，再恢复未完成作业。"
      onClose={restoring ? undefined : onClose}
      footer={<AppModalActions primaryLabel={restoring ? '正在恢复' : '恢复副本'}
        onPrimaryPress={onRestore} primaryDisabled={restoring || !selectedId}
        secondaryLabel="稍后" secondaryDisabled={restoring} onSecondaryPress={onClose} />}>
      <FlatList testID="restore-work-copy-list" style={styles.modalScrollArea} data={archives}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        scrollEnabled showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        keyExtractor={item => item.id}
        renderItem={({ item }) => <UiListItem title={formatDateTimeExport(item.createdAt)}
          subtitle={`${item.databaseFileName} · ${new Set([...item.entries, ...item.lateEntries].map(([key]) => key)).size} 项暂存`}
          icon={selectedId === item.id ? 'check-circle' : 'archive'} color={selectedId === item.id ? theme.primary : theme.textMuted}
          onPress={() => { if (!restoring) onSelect(item.id); }} />} />
    </AppModalCard>
  </AppModalViewport>;
}

export type ApkInstallStage = 'checking' | 'downloading' | 'backup' | 'installer';

export function ApkUpdateDialog({ styles, downloading, cachedReady = false, installStage = 'downloading', info, progress, onClose, onDownload }: {
  styles: DialogStyles;
  downloading: boolean;
  cachedReady?: boolean;
  installStage?: ApkInstallStage;
  info: { version: string; changelog: string } | null;
  progress: number;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [contentHeight, setContentHeight] = useState<number>();
  const stageText: Record<ApkInstallStage, string> = {
    checking: '正在核对安装包…',
    downloading: `下载中... ${progress}%`,
    backup: '安装前正在备份最新数据库…',
    installer: '请在系统安装器中完成安装；取消后可继续安装。',
  };
  return <AppModalViewport style={styles.updateModalOverlay}>
    <AppModalCard title="发现新版本"
      subtitle={downloading ? stageText[installStage] : cachedReady
        ? '安装包已下载，可继续安装；安装前仍会备份最新数据库。'
        : '请确认版本信息与更新内容，再决定是否下载安装。'}
      onClose={downloading ? undefined : onClose} style={styles.modalContent} bodyStyle={styles.modalBody}
      size="list" bodyContentHeight={contentHeight} stretchBody scrollMode="body"
      footer={!downloading ? <View style={styles.updateModalFooter}>
        <AppModalActions containerStyle={styles.modalActions} secondaryLabel="关闭" onSecondaryPress={onClose}
          primaryLabel={cachedReady ? '继续安装' : '下载更新'} onPrimaryPress={onDownload} />
      </View> : undefined}>
      <ScrollView testID="apk-update-changelog" style={styles.modalScrollArea}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        contentContainerStyle={styles.updateModalBodyContent} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" showsVerticalScrollIndicator scrollEventThrottle={16}>
        {info ? <>
          <View style={styles.updateVersionInfo}>
            <Text style={styles.updateVersionLabel}>新版本</Text>
            <Text style={styles.updateVersionText}>V{info.version}</Text>
          </View>
          <Text style={styles.updateChangelogTitle}>更新内容</Text>
          <Text style={styles.updateChangelogText}>{info.changelog}</Text>
          {downloading ? <View style={styles.downloadProgress}>
            {installStage === 'downloading' ? <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, { width: `${progress}%` }]} />
            </View> : null}
            <Text style={styles.progressText}>{stageText[installStage]}</Text>
          </View> : null}
        </> : null}
      </ScrollView>
    </AppModalCard>
  </AppModalViewport>;
}
import { useState } from 'react';
