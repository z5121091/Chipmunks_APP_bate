import { Image, StyleProp, ImageStyle } from 'react-native';

export const uiAssetIcons = {
  backupCloud: require('@/assets/images/ui-redesign/icons/icon_backup_cloud.png'),
  databaseSafe: require('@/assets/images/ui-redesign/icons/icon_database_safe.png'),
  documentManagement: require('@/assets/images/ui-redesign/icons/icon_document_management.png'),
  editQuantity: require('@/assets/images/ui-redesign/icons/icon_edit_quantity.png'),
  errorState: require('@/assets/images/ui-redesign/icons/icon_error_state.png'),
  exportFile: require('@/assets/images/ui-redesign/icons/icon_export.png'),
  importFile: require('@/assets/images/ui-redesign/icons/icon_import.png'),
  inboundScan: require('@/assets/images/ui-redesign/icons/icon_inbound_scan.png'),
  inventoryCount: require('@/assets/images/ui-redesign/icons/icon_inventory_count.png'),
  materialBinding: require('@/assets/images/ui-redesign/icons/icon_material_binding.png'),
  order: require('@/assets/images/ui-redesign/icons/icon_order.png'),
  outboundScan: require('@/assets/images/ui-redesign/icons/icon_outbound_scan.png'),
  packageSplit: require('@/assets/images/ui-redesign/icons/icon_package_split.png'),
  scanFrame: require('@/assets/images/ui-redesign/icons/icon_scan_frame.png'),
  search: require('@/assets/images/ui-redesign/icons/icon_search.png'),
  settings: require('@/assets/images/ui-redesign/icons/icon_settings.png'),
  stockQuery: require('@/assets/images/ui-redesign/icons/icon_search.png'),
  successState: require('@/assets/images/ui-redesign/icons/icon_success_state.png'),
  syncComputer: require('@/assets/images/ui-redesign/icons/icon_sync_computer.png'),
  templateExport: require('@/assets/images/ui-redesign/icons/icon_template_export.png'),
  warehouse: require('@/assets/images/ui-redesign/icons/icon_warehouse.png'),
  warningState: require('@/assets/images/ui-redesign/icons/icon_warning_state.png'),
} as const;

export type UiAssetIconName = keyof typeof uiAssetIcons;

type UiAssetIconProps = {
  name: UiAssetIconName;
  size: number;
  style?: StyleProp<ImageStyle>;
};

export function UiAssetIcon({ name, size, style }: UiAssetIconProps) {
  return (
    <Image
      source={uiAssetIcons[name]}
      resizeMode="contain"
      style={[{ width: size, height: size }, style]}
    />
  );
}
