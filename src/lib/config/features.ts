export interface FeatureConfig {
  key: string;
  label: string;
  category: 'plan' | 'add_on' | 'surerestore_type';
  description?: string;
  is_limit?: boolean;
  default_limit?: number;
  plan_flag?: string;
  phase?: number;
}

export const FEATURES: readonly FeatureConfig[] = [
  { key: 'reports',         label: 'Reports',            category: 'plan' },
  { key: 'api_access',      label: 'API Access',         category: 'plan' },
  { key: 'white_label',     label: 'White Label',        category: 'plan' },
  { key: 'multi_tool',      label: 'Multi Backup Tool',  category: 'plan' },
  { key: 'advanced_alerts', label: 'Advanced Alerts',    category: 'plan' },
  { key: 'chatbot_access',  label: 'MSP Chatbot Access', category: 'plan' },
  { key: 'ai_analysis',     label: 'AI Analysis',        category: 'plan' },
  {
    key: 'test_restore_access',
    label: 'Test Restore',
    description: 'Automated VM and file-level restore testing with RTO measurement and PSA ticket writeback',
    category: 'add_on',
    is_limit: false,
  },
  {
    key: 'test_restore_device_limit',
    label: 'Test Restore Device Limit',
    description: 'Max number of devices allowed for test restore schedules. -1 = unlimited.',
    category: 'add_on',
    is_limit: true,
    default_limit: 10,
  },
  {
    key: 'surerestore_file_restore',
    label: 'File & Folder Restore',
    description: 'Validates individual file/folder restores with RTO measurement and screenshot evidence.',
    category: 'surerestore_type',
    plan_flag: 'surerestore_file_restore',
    phase: 1,
  },
  {
    key: 'surerestore_vm_virtualization',
    label: 'VM Virtualization Test',
    description: 'Boots backed-up VM in isolated network and validates connectivity, services, and RTO target.',
    category: 'surerestore_type',
    plan_flag: 'surerestore_vm_virtualization',
    phase: 1,
  },
  {
    key: 'surerestore_cloud_bcdr',
    label: 'Cloud BCDR Failover',
    description: 'Triggers cloud failover test and validates workloads are reachable in the DR environment.',
    category: 'surerestore_type',
    plan_flag: 'surerestore_cloud_bcdr',
    phase: 2,
  },
  {
    key: 'surerestore_physical_host',
    label: 'Physical Host Restore',
    description: 'Validates bare-metal/physical host restore using BMR or dissimilar hardware restore.',
    category: 'surerestore_type',
    plan_flag: 'surerestore_physical_host',
    phase: 2,
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];

export const PLAN_FEATURES         = FEATURES.filter(f => f.category === 'plan');
export const ADDON_FEATURES        = FEATURES.filter(f => f.category === 'add_on');
export const SURERESTORE_TYPE_FEATURES = FEATURES.filter(f => f.category === 'surerestore_type');
