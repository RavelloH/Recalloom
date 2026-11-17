import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Token } from '@astryxdesign/core/Token';
import { TextInput } from '@astryxdesign/core/TextInput';
import { WorkspacePanel } from '../workspace-panels';
import { Icon } from '../icon';
import { mutate } from '../api';
import { ErrorText, LoadingRows, Empty } from '../pages/shared';
import { AutoResizer, AutoTransition } from '../motion-primitives';
import { normalizeTagKey, tagSimilarity } from '../../../src/tag-model';
import { tagDictionary, refreshTags, type Tag } from './data';
import { SmartTagControls } from './smart';
import type { TagSummary } from '../../../src/tag-model';
import './tags.css';

export function TagEditor({
  tags,
  onChange,
  recordId,
  tagDetails,
  revision,
  metadataRevision
}: {
  tags: string[];
  recordId?: string;
  tagDetails?: TagSummary[];
  revision?: number;
  metadataRevision?: number;
  onChange: (tag: string, action: 'add' | 'remove') => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const dictionary = useQuery({ ...tagDictionary(), enabled: open || tags.length > 0 });
  const run = async (name: string, action: 'add' | 'remove') => {
    setBusy(true);
    setError(undefined);
    try {
      await onChange(name, action);
      if (action === 'add') setOpen(false);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tag-editor">
      {tags.map((name) => {
        const tag =
          tagDetails?.find((tag) => tag.name === name) ??
          dictionary.data?.find((tag) => normalizeTagKey(tag.name) === normalizeTagKey(name));
        return tag?.source === 'auto' ? (
          <div key={name} className="tag-auto-item">
            <div className="tag-inline">
              <Token
                label={name}
                color={tag.color}
                size="sm"
                icon={<Icon name="sparkles" size="sm" />}
                href={'/tags/' + tag.id}
                isDisabled={busy}
                onRemove={() => void run(name, 'remove')}
              />
              <Button
                label="转为手动"
                aria-label={'将「' + name + '」转为手动标签'}
                size="sm"
                variant="ghost"
                isDisabled={busy}
                onClick={() => void run(name, 'add')}
              />
            </div>
            <p className="muted small">
              {tag.reason || '系统推荐'}
              {tag.sourceRevision ? ' · 依据 R' + tag.sourceRevision : ''}
            </p>
            {tag.evidence && <blockquote>{tag.evidence}</blockquote>}
          </div>
        ) : (
          <Token
            key={name}
            label={name}
            size="sm"
            color={tag?.color ?? 'gray'}
            href={tag ? '/tags/' + tag.id : undefined}
            isDisabled={busy}
            onRemove={() => void run(name, 'remove')}
          />
        );
      })}
      <Button
        label="添加标签"
        className="property-add"
        size="sm"
        variant="ghost"
        isIconOnly={tags.length > 0}
        icon={<Icon name="plus" size="sm" />}
        isDisabled={busy || tags.length >= 32}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      />
      {recordId && (
        <SmartTagControls
          recordId={recordId}
          revision={revision}
          metadataRevision={metadataRevision}
          hasAuto={Boolean(tagDetails?.some((tag) => tag.source === 'auto'))}
        />
      )}
      {Boolean(error) && !open && <ErrorText error={error} />}
      {mounted && (
        <WorkspacePanel
          id="record-tag-picker"
          label="添加标签"
          reserveSpace={false}
          open={open}
          onOpenChange={setOpen}
          onAfterClose={() => setMounted(false)}
        >
          <TagPicker tags={tags} onChoose={(name) => run(name, 'add')} busy={busy} error={error} />
        </WorkspacePanel>
      )}
    </div>
  );
}

function TagPicker({
  tags,
  onChoose,
  busy,
  error
}: {
  tags: string[];
  onChoose: (name: string) => Promise<void>;
  busy: boolean;
  error: unknown;
}) {
  const client = useQueryClient(),
    dictionary = useQuery(tagDictionary());
  const [query, setQuery] = useState(''),
    [aliasBusy, setAliasBusy] = useState(false),
    [aliasError, setAliasError] = useState<unknown>();
  const key = normalizeTagKey(query);
  const exact = dictionary.data?.find((tag) =>
    [tag.name, ...tag.aliases].some((name) => normalizeTagKey(name) === key)
  );
  const suggestions = useMemo(() => {
    const linked = new Set(tags.map(normalizeTagKey));
    return (dictionary.data ?? [])
      .filter((tag) => !linked.has(normalizeTagKey(tag.name)))
      .map((tag) => ({
        tag,
        score: key
          ? Math.max(...[tag.name, ...tag.aliases].map((name) => tagSimilarity(key, name)))
          : tag.count
      }))
      .filter((item) => !key || item.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [dictionary.data, key, tags]);
  const addAlias = async (tag: Tag) => {
    setAliasBusy(true);
    setAliasError(undefined);
    try {
      await mutate(
        '/tags/' + tag.id,
        {
          name: tag.name,
          aliases: [...tag.aliases, query.trim()],
          expectedMetadataRevision: tag.metadataRevision
        },
        'PATCH'
      );
      await refreshTags(client);
      await onChoose(tag.name);
    } catch (error) {
      setAliasError(error);
    } finally {
      setAliasBusy(false);
    }
  };
  return (
    <div className="tag-panel-body">
      <TextInput
        label="查找或创建标签"
        placeholder="输入名称或别名"
        width="100%"
        value={query}
        onChange={setQuery}
        onEnter={() => {
          if (exact) void onChoose(exact.name);
        }}
        hasAutoFocus
      />
      <AutoResizer>
        <AutoTransition
          transitionKey={
            dictionary.isPending ? 'loading' : dictionary.isError ? 'error' : key || 'popular'
          }
        >
          {dictionary.isPending ? (
            <LoadingRows count={3} kind="compact" />
          ) : dictionary.isError ? (
            <ErrorText error={dictionary.error} />
          ) : (
            <>
              <div className="tag-suggestions">
                {suggestions.map(({ tag }) => (
                  <div className="tag-suggestion" key={tag.id}>
                    <Button
                      label={tag.name}
                      variant="ghost"
                      width="100%"
                      isDisabled={busy || aliasBusy}
                      onClick={() => void onChoose(tag.name)}
                    />
                    {key && !exact && (
                      <Button
                        label="作为别名"
                        variant="ghost"
                        size="sm"
                        isDisabled={busy || aliasBusy}
                        onClick={() => void addAlias(tag)}
                      />
                    )}
                  </div>
                ))}
              </div>
              {!suggestions.length && <Empty title={key ? '没有匹配的标签' : '暂无可添加的标签'} />}
              {key && !exact && (
                <div className="tag-create">
                  <p className="muted">可选择相似标签，或将当前输入加入其别名。</p>
                  <Button
                    label={'创建「' + query.trim() + '」'}
                    variant="secondary"
                    isDisabled={busy || aliasBusy || query.trim().length > 64}
                    onClick={() => void onChoose(query.trim())}
                  />
                </div>
              )}
            </>
          )}
        </AutoTransition>
      </AutoResizer>
      {Boolean(error || aliasError) && <ErrorText error={error || aliasError} />}
    </div>
  );
}
