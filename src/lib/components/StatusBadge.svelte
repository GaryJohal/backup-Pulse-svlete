<script lang="ts">
  export let status: string | null | undefined;

  const map: Record<string, string> = {
    success:         'badge-success',
    failed:          'badge-failed',
    warning:         'badge-warning',
    action_required: 'badge-action',
  };

  $: cls = status ? (map[status] ?? 'badge-unknown') : 'badge-unknown';
  const labelMap: Record<string, string> = {
    success:         'Success',
    failed:          'Failed',
    warning:         'Warning',
    action_required: 'Completed w/ Warnings',
    unknown:         'Unknown',
  };
  $: label = status ? (labelMap[status] ?? status) : '—';
</script>

<span class={cls}>{label}</span>
