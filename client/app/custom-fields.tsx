import { Redirect } from 'expo-router';

// 保留旧链接入口，打开时跳转到当前页面。
export default function LegacyCustomFieldsRoute() {
  return <Redirect href="/rules" />;
}
