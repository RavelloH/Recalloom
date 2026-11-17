import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api, mutate } from '../api';
import { Icon } from '../icon';
import { AutoResizer, AutoTransition } from '../motion-primitives';
import { ErrorText } from '../pages/shared';
import { refreshTags } from './data';
import type { SmartSettings } from '../../../src/tag-model';

type SmartStatus = {
  settings: SmartSettings;
  metadataRevision: number;
  revision: number;
  waitingForIndex: boolean;
  job: null | { state: string; lastError: string | null; revision: number | null };
  ignored: Array<{ id: string; name: string }>;
  references: Array<{ id: string; name: string }>;
};
export function SmartTagControls({
  recordId,
  hasAuto,
  revision,
  metadataRevision
}: {
  recordId: string;
  hasAuto: boolean;
  revision?: number;
  metadataRevision?: number;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [ignoredOpen, setIgnoredOpen] = useState(false),
    [error, setError] = useState<unknown>();
  const q = useQuery({
    queryKey: ['smart-tags', recordId, revision, metadataRevision],
    queryFn: () => api<SmartStatus>('/records/' + recordId + '/smart-tags'),
    refetchInterval: (query) => {
      const status = query.state.data;
      if (!status?.settings.enabled) return false;
      if (status.waitingForIndex) return 12_000;
      return (
        ({ pending: 12_000, running: 4000, retry: 30_000 } as Record<string, number>)[
          status.job?.state ?? ''
        ] ?? false
      );
    }
  });
  useEffect(() => {
    const revision = q.data?.metadataRevision;
    const cached = client.getQueryData<{ metadataRevision: number }>(['record', recordId]);
    if (revision && cached && cached.metadataRevision !== revision) void refreshTags(client);
  }, [client, recordId, q.data?.metadataRevision]);
  const run = async (action: 'refresh' | 'accept_all' | 'restore', tagId?: string) => {
    if (!q.data) return;
    setBusy(true);
    setError(undefined);
    try {
      await mutate('/records/' + recordId + '/smart-tags', {
        action,
        tagId,
        expectedMetadataRevision: q.data.metadataRevision
      });
      await refreshTags(client);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const status = q.data;
  const state = q.isPending
    ? '正在加载推荐状态…'
    : !status?.settings.enabled
      ? '智能标签已关闭'
      : status.waitingForIndex
        ? '等待当前版本索引完成'
        : status.job?.state === 'running'
          ? '正在分析标签…'
          : status.job?.state === 'retry'
            ? '等待重试'
            : status.job?.state === 'pending'
              ? '等待分析'
              : status.job?.state === 'failed'
                ? '标签分析失败'
                : status.job?.state === 'done'
                  ? '推荐已更新 · R' + status.job.revision
                  : '索引完成后生成推荐';
  return (
    <div className="tag-smart">
      <AutoResizer>
        <AutoTransition transitionKey={state}>
          <p className="muted small" role="status">
            {state}
          </p>
        </AutoTransition>
      </AutoResizer>
      <div className="tag-inline">
        <Button
          label="重新分析"
          size="sm"
          variant="ghost"
          icon={<Icon name="sparkles" size="sm" />}
          isDisabled={busy || !status?.settings.enabled}
          onClick={() => void run('refresh')}
        />
        {hasAuto && (
          <Button
            label="全部转为手动"
            size="sm"
            variant="secondary"
            isDisabled={busy || !status}
            onClick={() => void run('accept_all')}
          />
        )}
      </div>
      {Boolean(error || q.error || status?.job?.lastError) && (
        <ErrorText error={error || q.error || new Error(status?.job?.lastError ?? '')} />
      )}
      {Boolean(status?.references.length) && (
        <p className="muted small">
          参考文稿 {status?.references.map((item) => item.name).join('、')}
        </p>
      )}
      {Boolean(status?.ignored.length) && (
        <Collapsible
          className="tag-ignored"
          trigger={'已忽略的标签（' + status?.ignored.length + '）'}
          isOpen={ignoredOpen}
          onOpenChange={setIgnoredOpen}
        >
          <div>
            {status?.ignored.map((tag) => (
              <Button
                key={tag.id}
                label={'恢复推荐「' + tag.name + '」'}
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onClick={() => void run('restore', tag.id)}
              />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

export function SmartTagSettings() {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ['smart-tags', 'settings'],
    queryFn: () =>
      api<{ settings: SmartSettings; counts: Array<{ state: string; count: number }> }>(
        '/smart-tags'
      )
  });
  const [model, setModel] = useState<string>(),
    [enabled, setEnabled] = useState<boolean>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const save = async () => {
    if (!q.data) return;
    setBusy(true);
    setError(undefined);
    try {
      await mutate(
        '/smart-tags',
        {
          enabled: enabled ?? q.data.settings.enabled,
          model: model ?? q.data.settings.model,
          expectedRevision: q.data.settings.revision
        },
        'PATCH'
      );
      await client.invalidateQueries({ queryKey: ['smart-tags'] });
      setEnabled(undefined);
      setModel(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await mutate('/smart-tags/refresh', {});
      await client.invalidateQueries({ queryKey: ['smart-tags'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tag-smart-settings" aria-label="智能标签设置">
      <CheckboxInput
        label="索引完成后自动推荐标签"
        value={enabled ?? q.data?.settings.enabled ?? false}
        onChange={setEnabled}
        isDisabled={busy || !q.data}
      />
      <div className="tag-inline tag-smart-model">
        <TextInput
          label="生成模型"
          width="100%"
          value={model ?? q.data?.settings.model ?? ''}
          onChange={setModel}
          isDisabled={busy || !q.data}
        />
        <Button
          label="保存设置"
          size="sm"
          isDisabled={busy || !q.data}
          onClick={() => void save()}
        />
      </div>
      <div className="tag-inline">
        <Button
          label="分析全部有效文稿"
          size="sm"
          variant="ghost"
          isDisabled={busy || !q.data?.settings.enabled}
          onClick={() => void refresh()}
        />
        <span className="muted small">
          {q.data?.counts
            .map(
              (item) =>
                (({
                  pending: '等待',
                  running: '分析中',
                  retry: '重试',
                  done: '完成',
                  failed: '失败'
                })[item.state] ?? item.state) +
                ' ' +
                item.count
            )
            .join(' · ')}
        </span>
      </div>
      {Boolean(error || q.error) && <ErrorText error={error || q.error} />}
    </section>
  );
}
