import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-lg font-semibold text-foreground">页面不存在</Text>
      <Link href="/" className="mt-8 text-base font-medium text-accent">
        返回首页
      </Link>
    </View>
  );
}
