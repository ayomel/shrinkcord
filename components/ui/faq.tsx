'use client';

import React, { useState, useId } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Plus, Minus, Search, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motionTransitions } from '../../lib/motion-tokens';

export interface FAQItem {
  id: string;
  question: string;
  answer: React.ReactNode;
  category?: string;
  badge?: string;
  icon?: React.ReactNode;
}

export interface FAQProps {
  /** List of FAQ items */
  items: FAQItem[];
  /** Allow multiple items to be expanded simultaneously */
  allowMultiple?: boolean;
  /** Initial open item IDs (uncontrolled) */
  defaultOpen?: string[] | string;
  /** Explicit open item IDs (controlled) */
  openIds?: string[];
  /** Callback fired when open items change */
  onOpenChange?: (ids: string[]) => void;
  /** Visual indicator icon style: chevron or plus-minus */
  iconStyle?: 'chevron' | 'plus-minus' | 'custom';
  /** Custom open/closed icon renderer */
  renderIcon?: (isOpen: boolean) => React.ReactNode;
  /** Enable search filter bar */
  searchable?: boolean;
  /** Placeholder text for search bar */
  searchPlaceholder?: string;
  /** Enable category filter tabs */
  showCategories?: boolean;
  /** Card visual layout presentation: single card container or separated individual cards */
  variant?: 'unified' | 'separated';
  /** Additional container styling */
  className?: string;
  /** Additional list styling (applies to the items wrapper) */
  listClassName?: string;
}

export const FAQ: React.FC<FAQProps> = ({
  items = [],
  allowMultiple = false,
  defaultOpen,
  openIds: controlledOpenIds,
  onOpenChange,
  iconStyle = 'chevron',
  renderIcon,
  searchable = false,
  searchPlaceholder = 'Search questions...',
  showCategories = false,
  variant = 'unified',
  className,
  listClassName,
}) => {
  const defaultInitial = defaultOpen
    ? Array.isArray(defaultOpen)
      ? defaultOpen
      : [defaultOpen]
    : [];

  const [internalOpenIds, setInternalOpenIds] = useState<string[]>(defaultInitial);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const baseId = useId();

  const isControlled = controlledOpenIds !== undefined;
  const activeOpenIds = isControlled ? controlledOpenIds : internalOpenIds;

  const categories = React.useMemo(() => {
    if (!showCategories) return [];
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return cats.size > 0 ? ['All', ...Array.from(cats)] : [];
  }, [items, showCategories]);

  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      const matchCategory =
        selectedCategory === 'All' || item.category === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (typeof item.answer === 'string' &&
          item.answer.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCategory && matchSearch;
    });
  }, [items, selectedCategory, searchQuery]);

  const toggleItem = (id: string) => {
    let nextIds: string[];
    if (allowMultiple) {
      nextIds = activeOpenIds.includes(id)
        ? activeOpenIds.filter((item) => item !== id)
        : [...activeOpenIds, id];
    } else {
      nextIds = activeOpenIds.includes(id) ? [] : [id];
    }

    if (!isControlled) {
      setInternalOpenIds(nextIds);
    }
    if (onOpenChange) {
      onOpenChange(nextIds);
    }
  };

  const renderItemIndicator = (isOpen: boolean) => {
    if (renderIcon) {
      return renderIcon(isOpen);
    }

    if (iconStyle === 'plus-minus') {
      return (
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={motionTransitions.springSnappy}
          className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
        >
          {isOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        </motion.div>
      );
    }

    return (
      <motion.div
        animate={{ rotate: isOpen ? 180 : 0 }}
        transition={motionTransitions.springSnappy}
        className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
      >
        <ChevronDown className="w-4 h-4" />
      </motion.div>
    );
  };

  return (
    <div className={cn('w-full space-y-4', className)}>
      {searchable && (
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-10 pl-10 pr-4 text-xs text-foreground placeholder:text-muted-foreground bg-card border border-border rounded-xl focus:border-brand focus:outline-none transition-colors"
          />
        </div>
      )}

      {showCategories && categories.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                selectedCategory === cat
                  ? 'bg-card text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-border bg-card">
          <HelpCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-60" />
          <p className="text-xs text-muted-foreground">No matching questions found.</p>
        </div>
      ) : variant === 'separated' ? (
        <div className={cn('grid gap-x-8 gap-y-0 lg:grid-cols-2', listClassName)}>
          {filteredItems.map((item) => {
            const isOpen = activeOpenIds.includes(item.id);
            const contentId = `${baseId}-content-${item.id}`;
            const headerId = `${baseId}-header-${item.id}`;

            return (
              <div key={item.id} className="border-b border-border py-[18px]">
                <button
                  id={headerId}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="group flex w-full items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 pr-2 min-w-0">
                    {item.icon && (
                      <span className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
                        {item.icon}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-[15.5px] font-semibold text-foreground">
                        {item.question}
                      </div>
                      {item.badge && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none bg-secondary border border-border text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </div>
                  {renderItemIndicator(isOpen)}
                </button>

                <div
                  id={contentId}
                  role="region"
                  aria-labelledby={headerId}
                  hidden={!isOpen}
                  className="pt-1.5 text-[14.5px] leading-relaxed text-muted-foreground"
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col divide-y divide-border rounded-lg border border-border bg-card overflow-hidden',
            listClassName
          )}
        >
          {filteredItems.map((item) => {
            const isOpen = activeOpenIds.includes(item.id);
            const contentId = `${baseId}-content-${item.id}`;
            const headerId = `${baseId}-header-${item.id}`;

            return (
              <div key={item.id} className="transition-colors">
                <button
                  id={headerId}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="group flex w-full items-center justify-between p-4 sm:p-5 text-left text-foreground hover:bg-secondary transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 pr-4">
                    {item.icon && (
                      <span className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
                        {item.icon}
                      </span>
                    )}
                    <div>
                      <div className="text-xs sm:text-sm font-medium text-foreground group-hover:text-white transition-colors">
                        {item.question}
                      </div>
                      {item.badge && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none bg-secondary border border-border text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </div>
                  {renderItemIndicator(isOpen)}
                </button>

                <div
                  id={contentId}
                  role="region"
                  aria-labelledby={headerId}
                  hidden={!isOpen}
                  className="px-4 pt-1 pb-4 text-sm leading-relaxed text-muted-foreground sm:px-5 sm:pb-5"
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
