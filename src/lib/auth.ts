import { writable, derived } from 'svelte/store';
import type { User } from './api';

function createAuthStore() {
  const _user = writable<User | null>(
    typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem('bp_user') ?? 'null')
      : null
  );

  return {
    subscribe: _user.subscribe,
    login(token: string, user: User) {
      localStorage.setItem('bp_token', token);
      localStorage.setItem('bp_user', JSON.stringify(user));
      _user.set(user);
    },
    updateUser(user: User) {
      localStorage.setItem('bp_user', JSON.stringify(user));
      _user.set(user);
    },
    logout() {
      localStorage.removeItem('bp_token');
      localStorage.removeItem('bp_user');
      _user.set(null);
    },
  };
}

export const auth = createAuthStore();
export const isLoggedIn = derived(auth, ($u) => $u !== null);
