import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type { CollectionDraft, CollectionHit, CollectionItem, CollectionResults, CollectionRule } from '../../../src/collection-model';
import { api, mutate, queryString } from '../api';
import { useConfirmDialog } from '../confirm-dialog';
import { Icon } from '../icon';
import { AutoResizer, AutoTransition } from '../motion-primitives';
import { statusLabels, taskStatuses } from '../tasks/data';
import { Empty, ErrorText, LoadingRows, PageTitle, Swap } from './shared';
import './collections.css';

const SearchSnippet = lazy(() => import('../search-snippet'));
const collectionListKey = ['collections', 'list'] as const;
const itemKey = (id: string) => ['collections', 'item', id] as const;
const initialPageParam = undefined as string | undefined;
const archives = [{ value: 'active', label: '未归档' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '包含归档' }] as const;
const targets = [{ value: 'document', label: '文稿' }, { value: 'task', label: '任务' }] as const;
const matches = [{ value: 'all', label: '全部匹配' }, { value: 'any', label: '任一匹配' }] as const;
const states = taskStatuses.map(value => ({ value, label: statusLabels[value] }));
type Parsed = { draft: CollectionDraft | null; issues: string[] };
type Preview = { rule: CollectionRule | null; issues: string[]; results: CollectionResults | null };
type RuleFields = { target: CollectionDraft['target']; folder: string; keyword: string; topic: string; tags: string; days: string; archive: 'active' | 'archived' | 'all'; tagMatch: 'all' | 'any'; taskList: string; statuses: NonNullable<Extract<CollectionDraft, { target: 'task' }>['statuses']> };

function fieldsFrom(source?: CollectionDraft | CollectionRule): RuleFields {
  const label = (ref?: string | { name: string }) => typeof ref === 'string' ? ref : ref?.name ?? '';
  const document = source?.target === 'document' ? source : undefined;
  const task = source?.target === 'task' ? source : undefined;
  return {
    target: source?.target ?? 'document', folder: label(source?.folder), keyword: source?.keyword ?? '',
    topic: document?.topic ?? '', tags: document?.tags?.map(label).join('，') ?? '', days: String(document?.updatedWithinDays ?? ''),
    archive: document?.archive ?? 'active', tagMatch: document?.tagMatch ?? 'all',
    taskList: label(task?.taskList), statuses: task?.statuses ?? []
  };
}

function draftFrom(fields: RuleFields): CollectionDraft {
  const { target, folder, keyword, topic, tags, days, archive, tagMatch, taskList, statuses } = fields;
  const base = { folder: folder.trim() || undefined, keyword: keyword.trim() || undefined };
  if (target === 'task') return { target, ...base, taskList: taskList.trim() || undefined, statuses: statuses.length ? statuses : undefined };
  return { target, ...base, topic: topic.trim() || undefined, tags: [...new Set(tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))], updatedWithinDays: days.trim() ? Number(days) : undefined, archive, tagMatch };
}

export function CollectionsPage() {
  const { collectionId } = useParams({ strict: false }) as { collectionId?: string };
  return collectionId ? <SavedCollection key={collectionId} id={collectionId} /> : <CollectionIndex />;
}

function CollectionIndex() {
  const [creating, setCreating] = useState(false);
  const list = useInfiniteQuery({ queryKey: collectionListKey, initialPageParam,
    queryFn: ({ pageParam, signal }) => api<{ items: CollectionItem[]; page: CollectionResults['page'] }>('/collections?' + queryString({ cursor: pageParam }), { signal }),
    getNextPageParam: page => page.page.nextCursor ?? undefined });
  const items = list.data?.pages.flatMap(page => page.items) ?? [];
  if (creating) return <CollectionEditor onCancel={() => setCreating(false)} />;
  return <div className="page workspace-page collections-page">
    <PageTitle title="智能集合" description="描述你想看的文稿或任务，把查询保存为可随时打开的集合。"
      actions={<Button label="新建集合" icon={<Icon name="plus" size="sm" />} size="sm" variant="primary" onClick={() => setCreating(true)} />} />
    <Swap state={list.isPending ? 'loading' : list.isError && !items.length ? 'error' : items.length ? 'ready' : 'empty'}>
      {list.isPending ? <LoadingRows /> : list.isError && !items.length ? <QueryError error={list.error} onRetry={() => void list.refetch()} /> : items.length ? (
        <div className="collection-list">{items.map(item => <Link className="collection-index-row" to="/collections/$collectionId" params={{ collectionId: item.id }} key={item.id}>
          <Icon name={item.rule.target === 'task' ? 'taskList' : 'sparkles'} size="md" />
          <span><strong>{item.name}</strong><small className="muted">{item.description || (item.rule.target === 'task' ? '任务集合' : '文稿集合')}</small></span>
          <Icon name="chevronRight" size="sm" />
        </Link>)}</div>
      ) : <Empty title="还没有智能集合" description="例如：最近 30 天更新的、关于编辑器性能的文稿。" />}
    </Swap>
    {list.isFetchNextPageError && <ErrorText error={list.error} />}
    {list.hasNextPage && <Button label="加载更多集合" variant="ghost" isLoading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />}
  </div>;
}

function SavedCollection({ id }: { id: string }) {
  const current = useQuery({ queryKey: itemKey(id), queryFn: ({ signal }) => api<{ item: CollectionItem }>('/collections/' + id, { signal }) });
  const [editing, setEditing] = useState(false);
  if (current.isPending) return <div className="page workspace-page"><PageTitle title="智能集合" /><LoadingRows /></div>;
  if (current.isError) return <div className="page workspace-page"><PageTitle title="智能集合" actions={<Link to="/collections" className="text-link">全部集合</Link>} /><QueryError error={current.error} onRetry={() => void current.refetch()} /></div>;
  const item = current.data.item;
  return editing ? <CollectionEditor item={item} onCancel={() => setEditing(false)} /> : <CollectionView key={item.revision} item={item} onEdit={() => setEditing(true)} />;
}

function CollectionView({ item, onEdit }: { item: CollectionItem; onEdit: () => void }) {
  const qc = useQueryClient(), navigate = useNavigate();
  const { confirm, confirmation } = useConfirmDialog();
  const [error, setError] = useState<unknown>(null), [removing, setRemoving] = useState(false);
  const results = useInfiniteQuery({ queryKey: [...itemKey(item.id), 'results', item.revision], initialPageParam, refetchOnMount: 'always',
    queryFn: ({ pageParam, signal }) => api<CollectionResults>('/collections/' + item.id + '/results?' + queryString({ cursor: pageParam, revision: item.revision }), { signal }),
    getNextPageParam: page => page.page.nextCursor ?? undefined });
  const first = results.data?.pages[0];
  const remove = async () => {
    if (!(await confirm({ title: '删除这个集合？', description: '只删除集合和筛选规则，集合里的文稿和任务会保留。', actionLabel: '删除集合', destructive: true }))) return;
    setRemoving(true); setError(null);
    try {
      await mutate('/collections/' + item.id, { expectedRevision: item.revision }, 'DELETE');
      await navigate({ to: '/collections' });
      qc.removeQueries({ queryKey: itemKey(item.id) });
      await qc.invalidateQueries({ queryKey: collectionListKey });
    } catch (cause) { setError(cause); }
    finally { setRemoving(false); }
  };
  return <div className="page workspace-page collections-page">{confirmation}
    <PageTitle title={item.name} description={item.description || undefined} actions={<><Link to="/collections" className="text-link">全部集合</Link>
      <Button label="编辑集合" size="sm" variant="secondary" onClick={onEdit} />
      <Button label="删除集合" size="sm" variant="ghost" isIconOnly icon={<Icon name="trash" size="sm" />} isLoading={removing} onClick={() => void remove()} /></>} />
    <RuleSummary rule={item.rule} />
    <div className="collection-section-title"><h2>集合内容</h2><Button label="刷新结果" size="sm" variant="ghost" isLoading={results.isRefetching} onClick={() => void qc.resetQueries({ queryKey: [...itemKey(item.id), 'results'] })} /></div>
    {Boolean(error) && <ErrorText error={error} />}
    {results.isPending ? <LoadingRows /> : results.isError && !first ? <QueryError error={results.error} onRetry={() => void results.refetch()} /> : first ? (
      <ResultList results={{ ...first, items: results.data!.pages.flatMap(page => page.items) }} />
    ) : null}
    {results.isFetchNextPageError && <QueryError error={results.error} onRetry={() => void qc.resetQueries({ queryKey: [...itemKey(item.id), 'results'] })} />}
    {results.hasNextPage && !results.isFetchNextPageError && <Button label="加载更多内容" size="sm" variant="ghost" isLoading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()} />}
  </div>;
}

function CollectionEditor({ item, onCancel }: { item?: CollectionItem; onCancel: () => void }) {
  const qc = useQueryClient(), navigate = useNavigate();
  const generated = useRef(new Map<string, Parsed>());
  const [name, setName] = useState(item?.name ?? ''), [description, setDescription] = useState(item?.description ?? '');
  const [fields, setFields] = useState(() => fieldsFrom(item?.rule));
  const [preview, setPreview] = useState<Preview | null>(null), [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<'generate' | 'preview' | 'save' | null>(null), [error, setError] = useState<unknown>(null);
  const change = <Key extends keyof RuleFields>(key: Key, value: RuleFields[Key]) => {
    setFields(current => ({ ...current, [key]: value })); setPreview(null);
  };
  const runPreview = async (next: RuleFields) => setPreview(await mutate<Preview>('/collections/preview', { draft: draftFrom(next), collectionId: item?.id }));
  const previewRules = async (generate: boolean) => {
    setBusy(generate ? 'generate' : 'preview'); setError(null); setPreview(null);
    try {
      let next = fields;
      if (generate) {
        const input = description.trim();
        let parsed = generated.current.get(input);
        if (!parsed) { parsed = await mutate<Parsed>('/collections/parse', { description: input }); generated.current.set(input, parsed); }
        setWarnings(parsed.issues);
        if (!parsed.draft) return;
        next = fieldsFrom(parsed.draft);
        setFields(next);
      }
      await runPreview(next);
    } catch (cause) { setError(cause); }
    finally { setBusy(null); }
  };
  const save = async () => {
    if (!preview?.rule || warnings.length || !name.trim()) return;
    setBusy('save'); setError(null);
    try {
      const { item: saved } = await mutate<{ item: CollectionItem }>('/collections' + (item ? '/' + item.id : ''), {
        name, description, rule: preview.rule, ...(item ? { expectedRevision: item.revision } : {})
      }, item ? 'PATCH' : 'POST');
      qc.setQueryData(itemKey(saved.id), { item: saved });
      void qc.invalidateQueries({ queryKey: collectionListKey });
      if (item) onCancel();
      else await navigate({ to: '/collections/$collectionId', params: { collectionId: saved.id } });
    } catch (cause) { setError(cause); }
    finally { setBusy(null); }
  };
  return <div className="page workspace-page collections-page">
    <PageTitle title={item ? '编辑集合' : '新建智能集合'} description="先描述你想找什么，再核对规则和预览。也可以直接填写规则。"
      actions={<Button size="sm" variant="ghost" label="取消" isDisabled={Boolean(busy)} onClick={onCancel} />} />
    <fieldset className="collection-form" disabled={Boolean(busy)}>
      <TextInput label="集合名称" value={name} width="100%" placeholder="例如：编辑器性能研究" onChange={setName} />
      <TextArea label="自然语言描述" value={description} maxLength={1200} width="100%" placeholder="例如：最近 30 天更新的、关于编辑器性能的文稿。" onChange={value => { setDescription(value); setWarnings([]); setPreview(null); }} />
      <div className="collection-actions"><Button label="生成规则" icon={<Icon name="sparkles" size="sm" />} variant="secondary" size="sm" isLoading={busy === 'generate'} isDisabled={!description.trim()} onClick={() => void previewRules(true)} /></div>
    </fieldset>
    <fieldset className="collection-form collection-rules" disabled={Boolean(busy)}>
      <legend>查询规则</legend>
      <div className="collection-rule-grid">
        <Selector label="内容类型" value={fields.target} options={[...targets]} width="100%" onChange={value => change('target', value as RuleFields['target'])} />
        <TextInput label="目录" width="100%" value={fields.folder} placeholder="名称或完整路径，包含子目录" onChange={value => change('folder', value)} />
        <TextInput label="包含关键词" width="100%" value={fields.keyword} placeholder="可选，匹配原文" onChange={value => change('keyword', value)} />
        {fields.target === 'task' ? <>
          <TextInput label="任务列表" width="100%" value={fields.taskList} placeholder="可选，与目录二选一" onChange={value => change('taskList', value)} />
          <MultiSelector label="任务状态" width="100%" options={states} value={fields.statuses} formatValue={values => values.length ? values.map(value => value.label).join('、') : '全部状态'} onChange={value => change('statuses', taskStatuses.filter(status => value.includes(status)))} />
        </> : <>
          <TextInput label="语义主题" width="100%" value={fields.topic} placeholder="可选，按含义找相关内容" onChange={value => change('topic', value)} />
          <TextInput label="标签" width="100%" value={fields.tags} placeholder="可选，多个标签用逗号分隔" onChange={value => change('tags', value)} />
          <Selector label="标签匹配" value={fields.tagMatch} options={[...matches]} width="100%" onChange={value => change('tagMatch', value as RuleFields['tagMatch'])} />
          <TextInput label="更新于最近几天" width="100%" value={fields.days} placeholder="可选，例如 30" onChange={value => change('days', value)} />
          <Selector label="归档范围" value={fields.archive} options={[...archives]} width="100%" onChange={value => change('archive', value as RuleFields['archive'])} />
        </>}
      </div>
      <div className="collection-actions">
        <Button label="预览规则" size="sm" variant="secondary" isLoading={busy === 'preview'} onClick={() => void previewRules(false)} />
        <Button label="保存集合" size="sm" variant="primary" isLoading={busy === 'save'} isDisabled={!preview?.rule || !name.trim() || warnings.length > 0} onClick={() => void save()} />
      </div>
    </fieldset>
    <AutoResizer><AutoTransition transitionKey={warnings.length ? 'warnings' : 'none'}>{warnings.length > 0 ? <div className="collection-notice" role="status">
      <strong>请核对这些条件</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      <Button label="已核对，以当前规则为准" size="sm" variant="ghost" onClick={() => setWarnings([])} />
    </div> : null}</AutoTransition></AutoResizer>
    {Boolean(error) && <ErrorText error={error} />}
    {(preview || busy === 'generate' || busy === 'preview') && <section className="collection-preview" aria-label="集合预览">
      <h2>预览结果</h2>
      {busy === 'generate' || busy === 'preview' ? <LoadingRows count={3} /> : preview?.issues.length ? <div className="collection-notice" role="status"><ul>{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div> : preview?.results ? <>
        {preview.rule && <RuleSummary rule={preview.rule} />}
        <ResultList results={preview.results} />
        {preview.results.page.nextCursor && <p className="muted small">预览前 {preview.results.items.length} 项。保存后可以查看更多。</p>}
      </> : null}
    </section>}
  </div>;
}

function RuleSummary({ rule }: { rule: CollectionRule }) {
  const labels = [rule.target === 'task' ? '任务' : '文稿'];
  if (rule.folder) labels.push('目录：' + rule.folder.name);
  if (rule.keyword) labels.push('关键词：' + rule.keyword);
  if (rule.target === 'task') {
    if (rule.taskList) labels.push('列表：' + rule.taskList.name);
    if (rule.statuses?.length) labels.push('状态：' + rule.statuses.map(status => statusLabels[status]).join('、'));
  } else {
    labels.push(archives.find(option => option.value === rule.archive)!.label);
    if (rule.updatedWithinDays) labels.push('最近 ' + rule.updatedWithinDays + ' 天更新');
    if (rule.topic) labels.push('主题：' + rule.topic);
    if (rule.tags?.length) labels.push('标签：' + rule.tags.map(tag => tag.name).join(rule.tagMatch === 'all' ? ' ＋ ' : ' 或 '));
  }
  return <div className="collection-chips" aria-label="已应用规则">{labels.map(label => <Token key={label} label={label} size="sm" />)}</div>;
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <div className="collection-notice"><ErrorText error={error} /><Button label="重试" size="sm" variant="ghost" onClick={onRetry} /></div>;
}

function ResultList({ results }: { results: CollectionResults }) {
  if (results.mode === 'unavailable') return <div className="collection-notice" role="status">语义检索暂不可用，暂时无法判断哪些文稿符合主题。</div>;
  return <>{results.mode === 'semantic' && <p className="muted small">显示当前索引中最相关的候选文稿。</p>}
    {results.items.length ? <div className="collection-list">{results.items.map(hit => <ResultRow hit={hit} key={hit.taskId ?? hit.id} />)}</div> : <Empty title="没有匹配的内容" description="可以调整规则后再查看。" />}
  </>;
}

function ResultRow({ hit }: { hit: CollectionHit }) {
  const [expanded, setExpanded] = useState(false);
  let meta: ReactNode = hit.location;
  if (hit.taskId && hit.status) meta = [hit.location, statusLabels[hit.status as keyof typeof statusLabels]].filter(Boolean).join(' · ');
  if (hit.status === 'archived') meta = [hit.location, '已归档'].filter(Boolean).join(' · ');
  return <div className="collection-result">
    <div className="collection-result-heading">
      <Link to="/records/$recordId" params={{ recordId: hit.id }} search={hit.taskId ? { task: hit.taskId } : undefined} className="collection-result-link">
        <Icon name={hit.taskId ? 'taskList' : 'document'} size="md" /><span><strong>{hit.name}</strong>{meta && <small className="muted">{meta}</small>}</span>
      </Link>
      {hit.snippetFormat && hit.text && <Button label={expanded ? '收起相关片段' : '查看相关片段'} size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} />}
    </div>
    {expanded && hit.text && <div className="collection-result-snippet"><Suspense fallback={<LoadingRows kind="compact" count={1} />}><SearchSnippet text={hit.text} format={hit.snippetFormat} query="" enabled={false} sourceId={hit.id} /></Suspense></div>}
  </div>;
}
