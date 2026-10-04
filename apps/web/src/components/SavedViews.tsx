import { useState } from 'react';

import { ConfirmDialog } from './ConfirmDialog';
import { Dropdown } from './Dropdown';
import { canEditView, viewSort } from '../lib/itemViewFilters';
import type { SavedViewsState } from '../lib/useSavedViews';
import type { User } from '../types';

const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60';

export function SavedViews({ state, user, projectId, canShare }: { state: SavedViewsState; user: User; projectId?: string; canShare: boolean }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'rename' | 'delete'>();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'PERSONAL' | 'SHARED'>('PERSONAL');
  const { selected, mutation } = state;
  const editable = selected && canEditView(selected, user);
  const execute = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) => {
    try {
      const result = await mutation.mutateAsync({ path, method, body });
      if (method === 'DELETE') state.detach();
      else if (result && dialog === 'save') state.choose(result.view);
      setDialog(undefined);
    } catch {
      // The mutation error is rendered inline so drafts and filters stay intact.
    }
  };
  const start = (kind: 'save' | 'rename' | 'delete') => {
    mutation.reset();
    setName(kind === 'rename' ? selected?.name ?? '' : '');
    setScope('PERSONAL');
    setDialog(kind);
  };

  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown open={open} onOpenChange={setOpen} label="Saved views" trigger={selected?.name ?? 'Saved views'}>
          <div className="grid gap-1 p-2">
            <button type="button" className={`${buttonClass} text-left`} onClick={() => { state.choose(); setOpen(false); }}>All items</button>
            {state.views.map((view) => <button type="button" className={`${buttonClass} text-left`} key={view.id} aria-current={selected?.id === view.id ? 'true' : undefined} onClick={() => { state.choose(view); setOpen(false); }}>
              {view.name} · {view.scope === 'PERSONAL' ? 'Personal' : 'Shared'}{view.isDefault && view.userId === user.id ? ' · Default' : ''}
            </button>)}
          </div>
        </Dropdown>
        <button type="button" className={buttonClass} onClick={() => start('save')}>Save view</button>
        {state.modified && <><span role="status">Modified</span><button type="button" className={buttonClass} onClick={() => state.choose(selected)}>Reset view</button></>}
        {editable && <>
          {state.modified && <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => void execute(`/views/${encodeURIComponent(selected.id)}`, 'PATCH', state.capture())}>Update view</button>}
          <button type="button" className={buttonClass} onClick={() => start('rename')}>Rename view</button>
          <button type="button" className={buttonClass} onClick={() => start('delete')}>Delete view</button>
        </>}
        {selected?.userId === user.id && !selected.isDefault && <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => void execute(`/views/${encodeURIComponent(selected.id)}/set-default`, 'POST', {})}>Set default</button>}
      </div>
      <p className="text-xs text-slate-500">Tag filtering is not supported by saved views or the item filter API.</p>
      {selected && selected.sortJson.field && `${selected.sortJson.field}-${selected.sortJson.direction}` !== viewSort(selected) && <p role="status">This saved sort is not supported by the item API. Showing score-desc instead.</p>}
      {state.viewsQuery.isError && <p role="alert">Could not load saved views. <button type="button" className={buttonClass} onClick={() => void state.viewsQuery.refetch()}>Retry saved views</button></p>}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {(dialog === 'save' || dialog === 'rename') && (
        <form role="dialog" aria-label={dialog === 'save' ? 'Save view' : 'Rename view'} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-300 p-3" onKeyDown={(event) => { if (event.key === 'Escape') setDialog(undefined); }} onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || mutation.isPending) return;
          if (dialog === 'rename' && selected) void execute(`/views/${encodeURIComponent(selected.id)}`, 'PATCH', { name: name.trim() });
          else void execute('/views', 'POST', { name: name.trim(), scope, projectId: projectId ?? null, ...state.capture() });
        }}>
          <label className="grid gap-1">View name<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-slate-300 p-2" /></label>
          {dialog === 'save' && canShare && <label className="grid gap-1">Visibility<select value={scope} onChange={(event) => setScope(event.target.value as 'PERSONAL' | 'SHARED')} className="rounded border border-slate-300 p-2"><option value="PERSONAL">Personal</option><option value="SHARED">Shared</option></select></label>}
          <button type="submit" className={buttonClass} disabled={mutation.isPending || !name.trim()}>{dialog === 'save' ? 'Save' : 'Rename'}</button>
          <button type="button" className={buttonClass} onClick={() => setDialog(undefined)}>Cancel</button>
        </form>
      )}
      {dialog === 'delete' && selected && <ConfirmDialog title="Delete saved view?" message={`Delete “${selected.name}”? Items will not be deleted.`} confirmLabel="Delete" tone="danger" busy={mutation.isPending} onCancel={() => setDialog(undefined)} onConfirm={() => void execute(`/views/${encodeURIComponent(selected.id)}`, 'DELETE')} />}
    </div>
  );
}
