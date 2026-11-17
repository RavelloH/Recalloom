import React, { useDeferredValue, useState } from 'react';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { Token } from '@astryxdesign/core/Token';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Icon } from '../icon';
import { api, queryString } from '../api';
import { WorkspaceSearch, WorkspaceToolbar } from '../workspace-toolbar';
import { AutoResizer, AutoTransition } from '../motion-primitives';
import { PageTitle, LoadingRows, ErrorText, Empty, fmt } from './shared';
import { tagPages, tagQuery, tagDictionary, type Tag, type TagFilter } from '../tags/data';
import {SmartTagSettings} from '../tags/smart';
import { TagPanel } from '../tags/panel';
import '../tags/tags.css';

export function TagsPage() {
  const { tagId } = useParams({ strict: false }) as { tagId?: string };
  const managing = useLocation({ select: (location) => location.pathname }) === '/tags/manage';
  return tagId ? (
    <TagDetail key={tagId} id={tagId} />
  ) : (
    <TagCatalog key={String(managing)} managing={managing} />
  );
}

function TagCloud({ tags, usage }: { tags: Tag[]; usage: TagFilter['usage'] }) {
  return (
    <div className="tag-cloud" aria-label="标签索引">
      {tags.map((tag) => {
        const count =
          usage === 'active'
            ? tag.activeCount
            : usage === 'archived'
              ? tag.archivedCount
              : tag.count;
        return (
          <Token
            key={tag.id}
            className="tag-cloud-token"
            label={tag.name}
            color={tag.color}
            size="md"
            href={'/tags/' + tag.id}
            description={'有效内容 ' + tag.activeCount + ' · 归档内容 ' + tag.archivedCount}
            endContent={<span className="tag-cloud-count">{count}</span>}
          />
        );
      })}
    </div>
  );
}

function TagCatalog({ managing }: { managing: boolean }) {
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<TagFilter['usage']>('all');
  const [sort, setSort] = useState<TagFilter['sort']>('count');
  const [editing, setEditing] = useState<Tag | null | undefined>();
  const search = useDeferredValue(query);
  const results = useInfiniteQuery(tagPages({ query: search, usage, sort }, managing ? 60 : 200));
  const tags = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="page workspace-page tags-page">
      <PageTitle
        title={managing ? '标签管理' : '标签'}
        description={managing ? '维护标签名称、别名和关联。' : '按标签查找文档和任务列表。'}
        actions={
          <>
            <Link to={managing ? '/tags' : '/tags/manage'} className="text-link">
              {managing ? '浏览标签' : '管理标签'}
            </Link>
            <Button
              label="新建标签"
              icon={<Icon name="plus" size="sm" />}
              size="sm"
              variant="primary"
              onClick={() => setEditing(null)}
            />
          </>
        }
      />
      {managing&&<SmartTagSettings/>}
      <WorkspaceToolbar
        search={
          <WorkspaceSearch
            label="搜索标签"
            placeholder="搜索名称或别名…"
            value={query}
            onChange={setQuery}
          />
        }
        filters={
          <>
            <Selector
              label="使用情况"
              isLabelHidden
              size="sm"
              value={usage}
              options={[
                { value: 'all', label: '全部标签' },
                { value: 'active', label: '有效内容' },
                { value: 'archived', label: '归档内容' },
                { value: 'unused', label: '未使用' }
              ]}
              onChange={(value) => setUsage(value as TagFilter['usage'])}
            />
            <Selector
              label="标签排序"
              isLabelHidden
              size="sm"
              value={sort}
              options={[
                { value: 'count', label: '使用最多' },
                { value: 'name', label: '名称顺序' },
                { value: 'updated', label: '最近修改' }
              ]}
              onChange={(value) => setSort(value as TagFilter['sort'])}
            />
          </>
        }
      />
      <AutoResizer>
        <AutoTransition
          transitionKey={
            results.isPending
              ? 'loading'
              : results.isError
                ? 'error'
                : JSON.stringify([search, usage, sort, tags.length === 0])
          }
        >
          {results.isPending ? (
            managing ? (
              <LoadingRows kind="files" />
            ) : (
              <div className="tag-cloud" role="status" aria-label="正在加载标签">
                {Array.from({ length: 40 }, (_, index) => (
                  <Skeleton
                    key={index}
                    width={[72, 104, 88, 128, 64][index % 5]}
                    height={28}
                    radius={2}
                  />
                ))}
              </div>
            )
          ) : results.isError ? (
            <div className="tag-error">
              <ErrorText error={results.error} />
              <Button label="重新加载" onClick={() => void results.refetch()} />
            </div>
          ) : tags.length && !managing ? (
            <TagCloud tags={tags} usage={usage} />
          ) : tags.length ? (
            <div className="tag-catalog">
              <div className="tag-catalog-heading">
                <span>标签</span>
                <span>有效内容</span>
                <span>归档内容</span>
                {managing && <span />}
              </div>
              {tags.map((tag) => (
                <div className="tag-catalog-row" key={tag.id}>
                  <Link to="/tags/$tagId" params={{ tagId: tag.id }} className="tag-catalog-name">
                    <Token label={tag.name} color={tag.color} size="sm" />
                    {tag.description && <span className="muted truncate">{tag.description}</span>}
                    {tag.aliases.length > 0 && (
                      <span className="muted tag-alias-summary">{tag.aliases.join(' · ')}</span>
                    )}
                  </Link>
                  <span className="tag-count">{tag.activeCount}</span>
                  <span className="tag-count muted">{tag.archivedCount}</span>
                  {managing && (
                    <Button
                      label={'管理 ' + tag.name}
                      icon={<Icon name="edit" size="sm" />}
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(tag)}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title={
                query ? '没有匹配的标签' : usage === 'unused' ? '没有未使用的标签' : '暂无标签'
              }
              description="可以在文档信息中添加标签，或在这里创建。"
            />
          )}
        </AutoTransition>
      </AutoResizer>
      {results.hasNextPage && (
        <Button
          label="加载更多标签"
          variant="ghost"
          isLoading={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        />
      )}
      {editing !== undefined && <TagPanel tag={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

type TaggedRecord = {
  id: string;
  name: string;
  kind: string;
  status: string;
  description: string;
  updatedAt: string;
  path: string;
};
type RecordPage = {
  items: TaggedRecord[];
  total: number;
  page: { hasMore: boolean; nextCursor: string | null };
};

function TagDetail({ id }: { id: string }) {
  const current = useQuery(tagQuery(id));
  const dictionary = useQuery(tagDictionary());
  const [selected, setSelected] = useState<string[]>([id]);
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const search = useDeferredValue(query);
  const resolvedId = current.data?.item.id ?? id;
  const ids = [...new Set(selected.map((value) => (value === id ? resolvedId : value)))].sort();
  const results = useInfiniteQuery({
    queryKey: ['tag-records', ids, match, status, kind, search],
    enabled: current.isSuccess,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<RecordPage>(
        '/tag-records?' +
          queryString({
            tagIds: ids.join(','),
            match,
            status,
            kind: kind === 'all' ? undefined : kind,
            query: search,
            limit: 40,
            cursor: pageParam
          })
      ),
    getNextPageParam: (page: RecordPage) => page.page.nextCursor ?? undefined
  });
  const tag = current.data?.item,
    records = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="page workspace-page tags-page">
      <PageTitle
        title={tag?.name ?? '标签'}
        description={tag?.description || '浏览具有这些标签的内容。'}
        actions={
          <>
            <Link to="/tags" className="text-link">
              全部标签
            </Link>
            <Button
              label="管理标签"
              size="sm"
              variant="secondary"
              isDisabled={!tag}
              onClick={() => setEditing(true)}
            />
          </>
        }
      />
      {tag && (
        <div className="tag-detail-meta">
          <Token label={tag.name} color={tag.color} size="sm" />
          <span className="muted">
            有效内容 {tag.activeCount} · 归档内容 {tag.archivedCount}
          </span>
          {tag.aliases.length > 0 && <span className="muted">别名 {tag.aliases.join(' · ')}</span>}
        </div>
      )}
      <WorkspaceToolbar
        search={
          <WorkspaceSearch
            label="搜索标签内容"
            placeholder="搜索名称或路径…"
            value={query}
            onChange={setQuery}
          />
        }
        filters={
          <>
            <MultiSelector
              label="标签组合"
              formatValue={(items) => items.length + ' 个标签'}
              isLabelHidden
              size="sm"
              hasSearch
              value={ids}
              options={(dictionary.data ?? (tag ? [tag] : [])).map((tag) => ({
                value: tag.id,
                label: tag.name
              }))}
              onChange={(values) => setSelected(values.length ? values : [resolvedId])}
            />
            <Selector
              label="匹配方式"
              isLabelHidden
              size="sm"
              value={match}
              options={[
                { value: 'all', label: '全部匹配' },
                { value: 'any', label: '任一匹配' }
              ]}
              onChange={(value) => setMatch(value as typeof match)}
            />
            <Selector
              label="内容范围"
              isLabelHidden
              size="sm"
              value={status}
              options={[
                { value: 'active', label: '有效内容' },
                { value: 'archived', label: '归档内容' },
                { value: 'all', label: '全部内容' }
              ]}
              onChange={(value) => setStatus(value as typeof status)}
            />
            <Selector
              label="内容类型"
              isLabelHidden
              size="sm"
              value={kind}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'document', label: '文档' },
                { value: 'task_list', label: '任务列表' }
              ]}
              onChange={(value) => setKind(String(value))}
            />
          </>
        }
      />
      <AutoResizer>
        <AutoTransition
          transitionKey={
            current.isError
              ? 'tag-error'
              : results.isPending
                ? 'loading'
                : results.isError
                  ? 'error'
                  : JSON.stringify([ids, match, status, kind, search, records.length === 0])
          }
        >
          {current.isError ? (
            <ErrorText error={current.error} />
          ) : results.isPending ? (
            <LoadingRows />
          ) : results.isError ? (
            <div className="tag-error">
              <ErrorText error={results.error} />
              <Button label="重新加载" onClick={() => void results.refetch()} />
            </div>
          ) : records.length ? (
            <div className="tag-records">
              {records.map((record) => (
                <Link
                  to="/records/$recordId"
                  params={{ recordId: record.id }}
                  className="tag-record-row"
                  key={record.id}
                >
                  <Icon name={record.kind === 'task_list' ? 'taskList' : 'document'} size="sm" />
                  <div>
                    <strong>{record.name}</strong>
                    <span className="muted">{record.path}</span>
                    {record.description && (
                      <span className="muted truncate">{record.description}</span>
                    )}
                  </div>
                  <span className="muted">
                    {record.status === 'archived' ? '已归档 · ' : ''}
                    {fmt(record.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="没有匹配的内容" description="可以调整标签组合和内容范围。" />
          )}
        </AutoTransition>
      </AutoResizer>
      {results.hasNextPage && (
        <Button
          label="加载更多内容"
          variant="ghost"
          isLoading={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        />
      )}
      {editing && tag && <TagPanel tag={tag} onClose={() => setEditing(false)} />}
    </div>
  );
}
