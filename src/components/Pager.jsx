// ‹ 2 / 5 ›: turns the pages of a list that shows only what fits (hooks/useFit.js). The buttons at either end stay
// focusable (aria-disabled, not disabled), so a keyboard player paging to the end keeps their place. Renders nothing for
// a single page.
import React from 'react';
import Icon from './Icon.jsx';

export default function Pager({ page = 0, pages = 1, onPage, label = 'Pages', className = '' }) {
  if (pages <= 1) return null;
  const go = target => { if (target >= 0 && target < pages) onPage?.(target); };
  return (
    <div className={`pager${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <button type="button" className="pager__btn" aria-label="Previous page" aria-disabled={page <= 0} onClick={() => go(page - 1)}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <span className="pager__pos num" aria-live="polite"><span className="sr-only">Page </span>{page + 1}<span aria-hidden="true"> / </span><span className="sr-only"> of </span>{pages}</span>
      <button type="button" className="pager__btn" aria-label="Next page" aria-disabled={page >= pages - 1} onClick={() => go(page + 1)}>
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}
