import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Selector } from '@astryxdesign/core/Selector';
import { Token } from '@astryxdesign/core/Token';
import { WorkspacePanel } from '../workspace-panels';
import { AutoResizer, AutoTransition } from '../motion-primitives';
import { useConfirmDialog } from '../confirm-dialog';
import { api, mutate } from '../api';
import { ErrorText, LoadingRows } from '../pages/shared';
import { tagColors, type TagColor } from '../../../src/tag-model';
import { refreshTags, tagDictionary, type Tag } from './data';
import './tags.css';

const colorNames: Record<TagColor, string> = {
  gray: '灰色',
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  purple: '紫色',
  pink: '粉色',
  cyan: '青色',
  teal: '蓝绿色'
};
type Impact = {
  source: Tag;
  target: Tag | null;
  duplicates: number;
  affectedRecords: number;
  activeCount: number;
  archivedCount: number;
  catalogVersion: number;
};

export function TagPanel({
  tag,
  onClose,
  onSaved
}: {
  tag: Tag | null;
  onClose: () => void;
  onSaved?: (tag: Tag) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <WorkspacePanel
      id={'tag-editor-' + (tag?.id ?? 'new')}
      label={tag ? '管理标签' : '新建标签'}
      reserveSpace={false}
      open={open}
      onOpenChange={setOpen}
      onAfterClose={onClose}
    >
      <TagForm key={tag?.id ?? 'new'} tag={tag} onClose={() => setOpen(false)} onSaved={onSaved} />
    </WorkspacePanel>
  );
}

function TagForm({
  tag,
  onClose,
  onSaved
}: {
  tag: Tag | null;
  onClose: () => void;
  onSaved?: (tag: Tag) => void;
}) {
  const client = useQueryClient();
  const dictionary = useQuery(tagDictionary());
  const [name, setName] = useState(tag?.name ?? '');
  const [description, setDescription] = useState(tag?.description ?? '');
  const [color, setColor] = useState<TagColor>(tag?.color ?? 'gray');
  const [smartEnabled, setSmartEnabled] = useState(tag?.smartEnabled ?? true);
  const [propagate, setPropagate] = useState(tag?.propagate ?? true);
  const [revision, setRevision] = useState(tag?.metadataRevision);
  const [aliases, setAliases] = useState(tag?.aliases ?? []);
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<{ action: 'merge' | 'delete'; impact: Impact } | null>(
    null
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const { confirm, confirmation } = useConfirmDialog();
  const addAlias = () => {
    const value = alias.trim();
    if (value && !aliases.includes(value)) setAliases([...aliases, value]);
    setAlias('');
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    const allAliases = alias.trim() ? [...aliases, alias.trim()] : aliases;
    try {
      const result = await mutate<{ item: Tag }>(
        tag ? '/tags/' + tag.id : '/tags',
        {
          name,
          smartEnabled,
          propagate,
          description,
          color,
          aliases: allAliases,
          ...(tag ? { expectedMetadataRevision: revision } : {})
        },
        tag ? 'PATCH' : 'POST'
      );
      await refreshTags(client);
      onSaved?.(result.item);
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    if (!tag) return;
    setBusy(true);
    try {
      const { item } = await api<{ item: Tag }>('/tags/' + tag.id);
      setSmartEnabled(item.smartEnabled);
      setPropagate(item.propagate);
      setName(item.name);
      setDescription(item.description);
      setColor(item.color);
      setAliases(item.aliases);
      setAlias('');
      setRevision(item.metadataRevision);
      setPreview(null);
      setError(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (action: 'merge' | 'delete') => {
    if (!tag) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview({
        action,
        impact: await api<Impact>(
          '/tags/' + tag.id + '/impact' + (action === 'merge' ? '?targetId=' + target : '')
        )
      });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!tag || !preview) return;
    const { action, impact } = preview;
    if (
      !(await confirm({
        title: action === 'merge' ? '合并标签？' : '删除标签？',
        description:
          '将影响 ' +
          impact.activeCount +
          ' 份有效内容、' +
          impact.archivedCount +
          ' 份归档内容。' +
          (action === 'merge'
            ? '合并到「' +
              impact.target?.name +
              '」，重叠的 ' +
              impact.duplicates +
              ' 项关联会自动去重。'
            : '这些内容中的标签关联将移除。'),
        actionLabel: action === 'merge' ? '确认合并' : '删除标签',
        destructive: true
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await mutate<{ item?: Tag }>(
        '/tags/' + tag.id + (action === 'merge' ? '/merge' : ''),
        {
          expectedMetadataRevision: impact.source.metadataRevision,
          expectedCatalogVersion: impact.catalogVersion,
          ...(action === 'merge'
            ? {
                targetId: impact.target!.id,
                expectedTargetRevision: impact.target!.metadataRevision
              }
            : {})
        },
        action === 'merge' ? 'POST' : 'DELETE'
      );
      await refreshTags(client);
      if (result.item) onSaved?.(result.item);
      onClose();
    } catch (error) {
      setError(error);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tag-panel-body">
      {confirmation}
      <form
        className="tag-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <CheckboxInput label="参与智能推荐" value={smartEnabled} onChange={setSmartEnabled} />
        <CheckboxInput label="作为相似文章的推荐依据" value={propagate} onChange={setPropagate} />
        <TextInput label="名称" value={name} onChange={setName} width="100%" />
        <TextArea label="描述" value={description} onChange={setDescription} width="100%" />
        <Selector
          label="颜色"
          value={color}
          options={tagColors.map((value) => ({ value, label: colorNames[value] }))}
          onChange={(value) => setColor(value as TagColor)}
          width="100%"
        />
        <div className="tag-form-aliases">
          <span className="muted">别名</span>
          <div className="tag-token-list">
            {aliases.map((value) => (
              <Token
                key={value}
                label={value}
                size="sm"
                onRemove={() => setAliases(aliases.filter((alias) => alias !== value))}
              />
            ))}
          </div>
          <div className="tag-inline">
            <TextInput
              label="添加别名"
              isLabelHidden
              placeholder="输入别名"
              value={alias}
              onChange={setAlias}
              onEnter={addAlias}
              width="100%"
            />
            <Button
              label="添加别名"
              variant="secondary"
              isDisabled={!alias.trim() || busy}
              onClick={addAlias}
            />
          </div>
        </div>
        {tag && <p className="muted">重命名后，原名称会自动保留为别名。</p>}
        <Button
          label={tag ? '保存标签' : '创建标签'}
          type="submit"
          variant="primary"
          isLoading={busy}
          isDisabled={busy || !name.trim()}
        />
      </form>
      {tag && (
        <section className="tag-danger-zone">
          <h3>合并与删除</h3>
          <p className="muted">
            有效内容 {tag.activeCount} · 归档内容 {tag.archivedCount}
          </p>
          {dictionary.isPending ? (
            <LoadingRows count={1} kind="compact" />
          ) : (
            <Selector
              label="合并到"
              placeholder="选择目标标签"
              hasSearch
              width="100%"
              value={target}
              options={(dictionary.data ?? [])
                .filter((item) => item.id !== tag.id)
                .map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => {
                setTarget(String(value));
                setPreview(null);
              }}
            />
          )}
          <div className="tag-inline">
            <Button
              label="预览合并"
              isDisabled={!target || busy}
              onClick={() => void inspect('merge')}
            />
            <Button
              label="预览删除"
              variant="ghost"
              isDisabled={busy}
              onClick={() => void inspect('delete')}
            />
          </div>
          <AutoResizer>
            <AutoTransition
              transitionKey={preview ? preview.action + preview.impact.catalogVersion : 'none'}
            >
              {preview && (
                <div className="tag-impact">
                  <p>
                    影响 {preview.impact.activeCount} 份有效内容、{preview.impact.archivedCount}{' '}
                    份归档内容
                    {preview.action === 'merge'
                      ? '，重叠 ' + preview.impact.duplicates + ' 项关联'
                      : ''}
                    。
                  </p>
                  <Button
                    label={preview.action === 'merge' ? '合并标签' : '删除标签'}
                    variant="destructive"
                    isDisabled={busy}
                    onClick={() => void apply()}
                  />
                </div>
              )}
            </AutoTransition>
          </AutoResizer>
        </section>
      )}
      <AutoResizer>
        <AutoTransition transitionKey={error ? 'error' : 'none'}>
          {Boolean(error) && (
            <div className="tag-error">
              <ErrorText error={error} />
              {tag && (
                <Button label="重新载入标签" isDisabled={busy} onClick={() => void reload()} />
              )}
            </div>
          )}
        </AutoTransition>
      </AutoResizer>
    </div>
  );
}
