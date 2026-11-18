import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Token } from '@astryxdesign/core/Token';
import type { TagSummary } from '../../../src/tag-model';
import { Icon } from '../icon';
import { AutoTransition } from '../motion-primitives';
import { ErrorText, LoadingRows } from '../pages/shared';
import { WorkspacePanel } from '../workspace-panels';
import { taggedRecordsPages, tagQuery } from './data';
import './tags.css';

const panelId = 'document-panel-tag';

export function RecordHeaderTags({ recordId, names, details }: {
  recordId: string;
  names: string[];
  details?: TagSummary[];
}) {
  const [selected, setSelected] = useState<TagSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [activation, setActivation] = useState(0);

  return <>
    {names.length > 0 && <div className="workbench-tag-line" aria-label="文档标签">
      {names.map(name => {
        const tag = details?.find(detail => detail.name === name);
        return <Token key={tag?.id ?? name} className="workbench-summary-tag" size="sm"
          label={name} color={tag?.color ?? 'gray'} description={tag?.reason}
          icon={tag?.source === 'auto' ? <Icon name="sparkles" size="sm" /> : undefined}
          aria-controls={open && selected?.id === tag?.id ? panelId : undefined}
          aria-expanded={tag ? open && selected?.id === tag.id : undefined}
          onClick={tag ? () => {
            setSelected(tag);
            setOpen(true);
            setActivation(value => value + 1);
          } : undefined}
        />;
      })}
    </div>}
    {selected && <WorkspacePanel id={panelId} label="标签详情" open={open}
      activationKey={activation} onOpenChange={setOpen} onAfterClose={() => setSelected(null)}>
      <TagPreview key={selected.id} tag={selected} recordId={recordId} />
    </WorkspacePanel>}
  </>;
}

function TagPreview({ tag, recordId }: { tag: TagSummary; recordId: string }) {
  const details = useQuery(tagQuery(tag.id));
  const definition = details.data?.item;
  const id = definition?.id ?? tag.id;
  const results = useInfiniteQuery(taggedRecordsPages({ tagIds: [id], status: 'all' }, 20));
  const records = results.data?.pages.flatMap(page => page.items) ?? [];

  return <div className="tag-panel-body tag-preview">
    <div className="tag-preview-meta">
      <div className="tag-token-list">
        <Token size="sm" label={definition?.name ?? tag.name} color={definition?.color ?? tag.color} />
        {definition && <span className="muted small">{definition.kind === 'fixed' ? '固定标签' : '智能标签'}</span>}
      </div>
      {definition?.description && <p>{definition.description}</p>}
      {definition && definition.aliases.length > 0 && <p className="muted small">别名：{definition.aliases.join(' · ')}</p>}
      {details.isError && <ErrorText error={details.error} />}
    </div>
    <section aria-labelledby="tag-preview-records-title">
      <div className="tag-preview-list-heading">
        <h3 id="tag-preview-records-title">同标签内容</h3>
        {definition && <span className="muted small">{definition.activeCount} 项有效 · {definition.archivedCount} 项归档</span>}
      </div>
      <AutoTransition transitionKey={results.isPending ? 'loading' : results.isError && !records.length ? 'error' : 'ready'}>
        {results.isPending ? <LoadingRows count={3} /> : results.isError && !records.length ? (
          <div className="tag-error">
            <ErrorText error={results.error} />
            <Button label="重试" size="sm" variant="ghost" onClick={() => void results.refetch()} />
          </div>
        ) : records.length ? <ul className="tag-preview-records">
          {records.map(record => {
            const current = record.id === recordId;
            const content = <>
              <Icon name={record.kind === 'task_list' ? 'taskList' : 'document'} size="sm" />
              <div>
                <strong>{record.name}</strong>
                <span className="muted">{record.path}</span>
              </div>
              {(current || record.status === 'archived') && <span className="muted">{current ? '当前文稿' : '已归档'}</span>}
            </>;
            return <li key={record.id}>
              {current ? <div className="tag-record-row" aria-current="page">{content}</div> :
                <Link className="tag-record-row" to="/records/$recordId" params={{ recordId: record.id }}>{content}</Link>}
            </li>;
          })}
        </ul> : <p className="muted small">暂无同标签内容</p>}
      </AutoTransition>
      {results.isFetchNextPageError && <ErrorText error={results.error} />}
      {results.hasNextPage && <Button label="加载更多内容" size="sm" variant="ghost"
        isLoading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()} />}
    </section>
    <Link className="text-link tag-preview-full-link" to="/tags/$tagId" params={{ tagId: id }}>
      打开标签页 <Icon name="chevronRight" size="sm" />
    </Link>
  </div>;
}
