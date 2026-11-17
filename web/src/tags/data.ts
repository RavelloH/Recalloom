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

export const tagQuery = (id: string) =>
  queryOptions({
    queryKey: ['tags', 'item', id],
    queryFn: () => api<{ item: Tag }>('/tags/' + id)
  });
export const tagPages = (filter: TagFilter) =>
  infiniteQueryOptions({
    queryKey: ['tags', 'pages', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<TagPage>('/tags?' + queryString({ ...filter, cursor: pageParam, limit: 60 })),
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
