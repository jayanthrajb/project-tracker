import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import type { MentionableUser } from '../types';

interface UsersPage {
  users: MentionableUser[];
  total: number;
}

export function useUserDirectory() {
  return useQuery({
    queryKey: ['users', 'mentionable'],
    queryFn: async () => {
      const users: MentionableUser[] = [];
      let page = 1;
      let total: number;
      do {
        const result = await api<UsersPage>(`/users?page=${page}&pageSize=100`);
        users.push(...result.users);
        total = result.total ?? users.length;
        page += 1;
        if (!result.users.length) break;
      } while (users.length < total);
      return { users };
    },
    staleTime: 5 * 60_000,
  });
}
