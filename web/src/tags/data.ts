import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, queryString } from '../api';
import type { Tag } from '../../../src/tag-model';
export type { Tag } from '../../../src/tag-model';
export type TagPage = {
  items: Tag[];
  version: number;
  page: { hasMore: boolean; nextCursor: string | null };
};
export type TagFilter = {
  query?: string;
  usage?: 'all' | 'active' | 'archived' | 'unused';
  sort?: 'name' | 'count' | 'updated';
};

export type TaggedRecord = {
  id: string;
  name: string;
  kind: string;
  status: string;
  description: string;
  updatedAt: string;
  path: string;
  tagSource: 'manual' | 'auto' | 'mixed';
};
type TaggedRecordsPage = {
  items: TaggedRecord[];
  total: number;
  page: TagPage['page'];
};
type TaggedRecordsFilter = {
  tagIds: string[];
  match?: 'all' | 'any';
  status?: 'active' | 'archived' | 'all';
  kind?: string;
  query?: string;
};

export const taggedRecordsPages = ({ tagIds, ...filter }: TaggedRecordsFilter, limit = 40) =>
  infiniteQueryOptions({
    queryKey: ['tag-records', tagIds, filter, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<TaggedRecordsPage>(
      '/tag-records?' + queryString({ ...filter, tagIds: tagIds.join(','), limit, cursor: pageParam }),
      { signal }
    ),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined
  });

export const tagQuery = (id: string) =>
  queryOptions({
    queryKey: ['tags', 'item', id],
    queryFn: () => api<{ item: Tag }>('/tags/' + id)
  });
export const tagPages = (filter: TagFilter, limit = 60) =>
  infiniteQueryOptions({
    queryKey: ['tags', 'pages', filter, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<TagPage>('/tags?' + queryString({ ...filter, cursor: pageParam, limit })),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined
  });
export const tagDictionary = () =>
  queryOptions({
    queryKey: ['tags', 'dictionary'],
    staleTime: 30_000,
    queryFn: async () => {
      const items: Tag[] = [];
      let cursor: string | undefined;
      do {
        const page = await api<TagPage>('/tags?' + queryString({ limit: 200, cursor }));
        items.push(...page.items);
        cursor = page.page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    }
  });
export async function refreshTags(client: QueryClient) {
  await Promise.all(
    [
      'tags',
      'smart-tags',
      'tag-records',
      'record',
      'browse',
      'browse-pages',
      'archived-records',
      'recent-updates',
      'activity',
      'activity-feed',
      'activity-summary',
      'recent-activity'
    ].map((key) => client.invalidateQueries({ queryKey: [key] }))
  );
}
