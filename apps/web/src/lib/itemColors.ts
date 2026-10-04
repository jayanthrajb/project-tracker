import type { ItemPriority, ItemRisk } from '../types';

export const priorityColors: Record<ItemPriority, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-orange-100 text-orange-700',
  P2: 'bg-blue-100 text-blue-700',
  P3: 'bg-slate-100 text-slate-700',
};

export const riskColors: Record<ItemRisk, string> = {
  HIGH: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-emerald-100 text-emerald-700',
};

export const neutralColor = 'bg-slate-100 text-slate-700';
