<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';

  let email = '';
  let password = '';
  let tenantSlug = '';
  let error = '';
  let loading = false;

  async function submit() {
    error = '';
    loading = true;
    try {
      const res = await api.login(email, password, tenantSlug);
      auth.login(res.access_token, res.user);
      goto(res.user.tenant_type === 'platform' ? '/manage' : '/');
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-100">
  <div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
    <h1 class="text-2xl font-bold text-brand-900 mb-6 text-center">BackupPulse</h1>

    <form on:submit|preventDefault={submit} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Tenant Slug</label>
        <input bind:value={tenantSlug} type="text" required placeholder="e.g. itbd"
          class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input bind:value={email} type="email" required
          class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input bind:value={password} type="password" required
          class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
      </div>

      {#if error}
        <p class="text-red-600 text-sm">{error}</p>
      {/if}

      <button type="submit" class="btn-secondary w-full" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  </div>
</div>
