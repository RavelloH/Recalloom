import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { api, mutate } from '../api';
import { ErrorText } from '../pages/shared';
import { refreshTags } from './data';

type TagStatus = {
  metadataRevision: number;
  revision: number;
  indexReady: boolean;
  ignored: Array<{ id: string; name: string }>;
  references: Array<{ id: string; name: string }>;
};

export function SmartTagControls({
  recordId, hasAuto, revision, metadataRevision
}: {
  recordId: string;
  hasAuto: boolean;
  revision?: number;
  metadataRevision?: number;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [error, setError] = useState<unknown>();
  const q = useQuery({
    queryKey: ['smart-tags', recordId, revision, metadataRevision],
    queryFn: () => api<TagStatus>('/records/' + recordId + '/smart-tags')
  });
  const run = async (action: 'accept_all' | 'restore', tagId?: string) => {
    if (!q.data) return;
    setBusy(true);
    setError(undefined);
    try {
      await mutate('/records/' + recordId + '/smart-tags', {
        action, tagId, expectedMetadataRevision: q.data.metadataRevision
      });
      await refreshTags(client);
      await client.invalidateQueries({ queryKey: ['smart-tags', recordId] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const status = q.data;
  return (
    <div className="tag-smart">
      {hasAuto && (
        <div className="tag-inline">
          <Button label="全部转为手动" size="sm" variant="secondary"
            isDisabled={busy || !status} onClick={() => void run('accept_all')} />
        </div>
      )}
      {Boolean(error || q.error) && <ErrorText error={error || q.error} />}
      {Boolean(status?.references.length) && (
        <p className="muted small">
          参考文稿 {status?.references.map(item => item.name).join('、')}
        </p>
      )}
      {Boolean(status?.ignored.length) && (
        <Collapsible className="tag-ignored"
          trigger={'已忽略的标签（' + status?.ignored.length + '）'}
          isOpen={ignoredOpen} onOpenChange={setIgnoredOpen}>
          <div>
            {status?.ignored.map(tag => (
              <Button key={tag.id} label={'恢复推荐「' + tag.name + '」'}
                variant="ghost" size="sm" isDisabled={busy}
                onClick={() => void run('restore', tag.id)} />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}
