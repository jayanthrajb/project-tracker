import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { filterMentionCandidates, findMentionQuery, insertMention, mentionToken } from '../lib/mentions';
import type { MentionQuery } from '../lib/mentions';
import { cn, initials } from '../lib/utils';
import type { MentionableUser } from '../types';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  users: MentionableUser[];
  preferredIds: ReadonlySet<string>;
  onSubmit: () => void;
  onEscape?: () => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
}

export function MentionTextarea({
  value,
  onChange,
  users,
  preferredIds,
  onSubmit,
  onEscape,
  disabled,
  placeholder,
  ariaLabel,
  autoFocus,
  className,
}: MentionTextareaProps) {
  const listboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates = useMemo(
    () => (mention ? filterMentionCandidates(users, mention.query, preferredIds) : []),
    [mention, users, preferredIds],
  );
  const open = candidates.length > 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && pendingCaret.current !== null) {
      textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const updateMention = (text: string, caret: number | null) => {
    const next = caret === null ? null : findMentionQuery(text, caret);
    if (!next || next.start !== dismissedStart) setDismissedStart(null);
    const visible = next && next.start !== dismissedStart ? next : null;
    if (mention?.start !== visible?.start || mention?.query !== visible?.query) setActiveIndex(0);
    setMention(visible);
  };

  const choose = (user: MentionableUser) => {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;
    const result = insertMention(value, mention, user, textarea.selectionStart);
    pendingCaret.current = result.caret;
    setMention(null);
    onChange(result.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((index) => (index + step + candidates.length) % candidates.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        choose(candidates[Math.min(activeIndex, candidates.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissedStart(mention?.start ?? null);
        setMention(null);
        return;
      }
    }
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        autoFocus={autoFocus}
        className={cn('min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50', className)}
        onChange={(event) => {
          onChange(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Mention a user"
          className="absolute left-0 top-full z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {candidates.map((user, index) => (
            <li
              key={user.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5', index === activeIndex && 'bg-slate-100')}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(user);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700">
                {initials(user.name)}
              </span>
              <span className="flex-1 truncate">{user.name}</span>
              <span className="text-xs text-slate-400">{mentionToken(user)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
